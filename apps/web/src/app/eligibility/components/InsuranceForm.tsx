'use client';

import { useState } from 'react';
import type { InsuranceInfo } from '@eligibility-agent/shared';
import { Camera, Edit2 } from 'lucide-react';

interface InsuranceFormProps {
  insurance: InsuranceInfo | null;
  onChange: (insurance: InsuranceInfo) => void;
  disabled?: boolean;
}

export default function InsuranceForm({ insurance, onChange, disabled }: InsuranceFormProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isEditingPayer, setIsEditingPayer] = useState(false);

  const handleFieldChange = (field: keyof InsuranceInfo, value: string) => {
    onChange({
      payerName: insurance?.payerName || '',
      memberId: insurance?.memberId || '',
      ...insurance,
      [field]: value,
    });
  };

  const handleCardUpload = async (file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('card', file);

      const response = await fetch('/api/card-parse', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (response.ok && data.data) {
        onChange({
          ...insurance,
          payerName: data.data.payerName || insurance?.payerName || '',
          memberId: data.data.memberId || insurance?.memberId || '',
          groupNumber: data.data.groupNumber || insurance?.groupNumber,
        });
      }
    } catch {
      // Silently fail - user can manually enter insurance details
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section className="card p-4">
      <h2 className="text-sm font-medium text-neutral-500 mb-3">Insurance</h2>

      <div className="space-y-3">
        {/* Payer Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-neutral-500">Payer</label>
            {!disabled && !isEditingPayer && (
              <button
                onClick={() => setIsEditingPayer(true)}
                className="text-xs text-primary-500 hover:text-primary-600 flex items-center gap-1"
              >
                <Edit2 className="w-3 h-3" /> Edit
              </button>
            )}
          </div>
          {isEditingPayer ? (
            <input
              type="text"
              value={insurance?.payerName || ''}
              onChange={(e) => handleFieldChange('payerName', e.target.value)}
              onBlur={() => setIsEditingPayer(false)}
              className="input text-sm"
              placeholder="Enter payer name"
              autoFocus
              disabled={disabled}
            />
          ) : (
            <div className="text-sm text-neutral-800">
              {insurance?.payerName || <span className="text-neutral-400">Not available</span>}
            </div>
          )}
        </div>

        {/* Member ID */}
        <div>
          <label htmlFor="memberId" className="text-xs text-neutral-500 block mb-1">
            Member ID <span className="text-red-500">*</span>
          </label>
          <input
            id="memberId"
            type="text"
            value={insurance?.memberId || ''}
            onChange={(e) => handleFieldChange('memberId', e.target.value)}
            placeholder="Enter member ID"
            className="input text-sm"
            disabled={disabled}
          />
        </div>

        {/* Group Number */}
        <div>
          <label htmlFor="groupNumber" className="text-xs text-neutral-500 block mb-1">
            Group Number
          </label>
          <input
            id="groupNumber"
            type="text"
            value={insurance?.groupNumber || ''}
            onChange={(e) => handleFieldChange('groupNumber', e.target.value)}
            placeholder="Optional"
            className="input text-sm"
            disabled={disabled}
          />
        </div>

        {/* Card Upload */}
        <label className="block pt-1">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCardUpload(file);
            }}
            disabled={disabled || isUploading}
          />
          <div className="btn btn-ghost text-sm w-full justify-center gap-2 cursor-pointer border border-dashed border-neutral-200 hover:border-neutral-300">
            {isUploading ? (
              <>
                <div className="w-4 h-4 border-2 border-neutral-300 border-t-neutral-600 rounded-full animate-spin" />
                Parsing...
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                Scan insurance card
              </>
            )}
          </div>
        </label>
      </div>
    </section>
  );
}
