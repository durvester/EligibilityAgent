'use client';

import { useState, useRef, useEffect } from 'react';
import { SERVICE_TYPES } from '@eligibility-agent/shared';
import { ChevronDown, X, Check, Loader2 } from 'lucide-react';

interface ServiceTypeSelectProps {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

// Commonly used service types shown first
const COMMON_CODES = ['30', '1', '98', '47', '48', '50', '33', '60', '88'];
const BATCH_SIZE = 15;

export default function ServiceTypeSelect({ value, onChange, disabled }: ServiceTypeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Sort: common first, then alphabetically
  const allEntries = Object.entries(SERVICE_TYPES).sort(([a], [b]) => {
    const aCommon = COMMON_CODES.indexOf(a);
    const bCommon = COMMON_CODES.indexOf(b);
    if (aCommon !== -1 && bCommon !== -1) return aCommon - bCommon;
    if (aCommon !== -1) return -1;
    if (bCommon !== -1) return 1;
    return a.localeCompare(b);
  });

  const visibleEntries = allEntries.slice(0, visibleCount);
  const hasMore = visibleCount < allEntries.length;

  // Intersection observer for lazy scroll
  useEffect(() => {
    if (!isOpen || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setVisibleCount(prev => Math.min(prev + BATCH_SIZE, allEntries.length));
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
  }, [isOpen, hasMore, allEntries.length]);

  // Reset visible count when closing
  useEffect(() => {
    if (!isOpen) {
      setVisibleCount(BATCH_SIZE);
    }
  }, [isOpen]);

  const selectedDescription = SERVICE_TYPES[value as keyof typeof SERVICE_TYPES] || 'Unknown';

  const selectType = (code: string) => {
    onChange(code);
    setIsOpen(false);
  };

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-neutral-500">Service Type</h2>
      </div>

      {/* Dropdown trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className="w-full flex items-center justify-between p-2.5 rounded-lg border border-neutral-200 hover:border-neutral-300 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm text-neutral-900 truncate">{selectedDescription}</p>
            <p className="text-xs text-neutral-400">Code: {value}</p>
          </div>
          <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ml-2 ${isOpen ? 'rotate-180' : ''}`} />
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
                <span className="text-xs font-medium text-neutral-500">Select Service Type</span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 hover:bg-neutral-200 rounded"
                >
                  <X className="w-3 h-3 text-neutral-400" />
                </button>
              </div>

              {/* Scrollable list */}
              <div ref={listRef} className="overflow-y-auto max-h-52">
                {visibleEntries.map(([code, description]) => (
                  <button
                    key={code}
                    onClick={() => selectType(code)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-neutral-50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-neutral-800 block truncate">{description}</span>
                      <span className="text-xs text-neutral-400">{code}</span>
                    </div>
                    {value === code && (
                      <Check className="w-4 h-4 text-primary-500 flex-shrink-0 ml-2" />
                    )}
                  </button>
                ))}

                {/* Load more trigger */}
                <div ref={loadMoreRef} className="px-3 py-2 text-center">
                  {hasMore && (
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-400 mx-auto" />
                  )}
                  {!hasMore && (
                    <span className="text-xs text-neutral-400">All types loaded</span>
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
