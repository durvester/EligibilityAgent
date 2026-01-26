'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProviderInfo as ProviderInfoType } from '@eligibility-agent/shared';
import { User, ChevronDown, X, Loader2, Check } from 'lucide-react';

interface ProviderInfoProps {
  provider: ProviderInfoType | null;
  onChange: (provider: ProviderInfoType | null) => void;
  disabled?: boolean;
}

export default function ProviderInfo({ provider, onChange, disabled }: ProviderInfoProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [practitioners, setPractitioners] = useState<ProviderInfoType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Fetch practitioners with pagination
  const fetchPractitioners = useCallback(async (currentOffset: number, append = false) => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const accessToken = sessionStorage.getItem('smart_access_token');
      const fhirBaseUrl = sessionStorage.getItem('smart_fhir_base_url');

      const response = await fetch(
        `/api/fhir/practitioners?_count=20&_offset=${currentOffset}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-FHIR-Base-URL': fhirBaseUrl || '',
          },
        }
      );

      const data = await response.json();
      if (data.success) {
        const newPractitioners = data.practitioners || [];
        setPractitioners(prev => append ? [...prev, ...newPractitioners] : newPractitioners);
        setHasMore(data.pagination?.hasMore ?? newPractitioners.length === 20);
        setOffset(currentOffset + newPractitioners.length);
      }
    } catch (err) {
      console.error('Failed to fetch practitioners:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  // Load initial practitioners when dropdown opens
  useEffect(() => {
    if (isOpen && practitioners.length === 0) {
      fetchPractitioners(0);
    }
  }, [isOpen, practitioners.length, fetchPractitioners]);

  // Intersection observer for lazy scroll
  useEffect(() => {
    if (!isOpen || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading && hasMore) {
          fetchPractitioners(offset, true);
        }
      },
      { root: listRef.current, threshold: 0.1 }
    );

    const loadMoreElement = loadMoreRef.current;
    if (loadMoreElement) {
      observer.observe(loadMoreElement);
    }

    return () => {
      if (loadMoreElement) {
        observer.unobserve(loadMoreElement);
      }
    };
  }, [isOpen, hasMore, isLoading, offset, fetchPractitioners]);

  const selectProvider = (p: ProviderInfoType) => {
    onChange(p);
    setIsOpen(false);
  };

  const formatProviderName = (p: ProviderInfoType) => {
    const name = `${p.firstName} ${p.lastName}`.trim();
    return p.credentials ? `${name}, ${p.credentials}` : name;
  };

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-neutral-500">Rendering Provider</h2>
      </div>

      {/* Dropdown trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className="w-full flex items-center gap-3 p-2 rounded-lg border border-neutral-200 hover:border-neutral-300 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="w-8 h-8 rounded-full bg-primary-50 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-primary-500" />
          </div>
          <div className="flex-1 min-w-0">
            {provider ? (
              <>
                <p className="text-sm font-medium text-neutral-900 truncate">
                  {formatProviderName(provider)}
                </p>
                {!provider.npi && (
                  <p className="text-xs text-amber-600">NPI will be looked up</p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm text-neutral-600">Select a provider</p>
                <p className="text-xs text-neutral-400">Optional</p>
              </>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown list */}
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />

            {/* Dropdown panel */}
            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white rounded-lg border border-neutral-200 shadow-lg max-h-64 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 bg-neutral-50">
                <span className="text-xs font-medium text-neutral-500">Select Provider</span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-neutral-200 rounded"
                >
                  <X className="w-3 h-3 text-neutral-400" />
                </button>
              </div>

              {/* Scrollable list */}
              <div ref={listRef} className="overflow-y-auto max-h-52">
                {practitioners.map((p) => (
                  <button
                    key={p.fhirId}
                    onClick={() => selectProvider(p)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-full bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <User className="w-3.5 h-3.5 text-neutral-400" />
                    </div>
                    <span className="text-sm text-neutral-800 flex-1 truncate">
                      {formatProviderName(p)}
                    </span>
                    {provider?.fhirId === p.fhirId && (
                      <Check className="w-4 h-4 text-primary-500 flex-shrink-0" />
                    )}
                  </button>
                ))}

                {/* Load more trigger / Loading indicator */}
                <div ref={loadMoreRef} className="px-3 py-2 text-center">
                  {isLoading && (
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-400 mx-auto" />
                  )}
                  {!isLoading && !hasMore && practitioners.length > 0 && (
                    <span className="text-xs text-neutral-400">All providers loaded</span>
                  )}
                  {!isLoading && practitioners.length === 0 && (
                    <span className="text-xs text-neutral-400">No providers found</span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
