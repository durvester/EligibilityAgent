'use client';

import { CheckCircle2, Clock, Building2, FileCode, ExternalLink } from 'lucide-react';
import type { SourceAttribution as SourceAttributionType } from '@eligibility-agent/shared';

interface SourceAttributionProps {
  source: SourceAttributionType;
  onViewRawResponse?: () => void;
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

export default function SourceAttribution({ source, onViewRawResponse }: SourceAttributionProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        <span className="text-sm font-medium text-green-800">Verified via Stedi API</span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Payer */}
        <div className="flex items-center gap-1.5 text-green-700">
          <Building2 className="w-3.5 h-3.5 text-green-500" />
          <span className="text-green-600">Payer:</span>
          <span className="font-medium truncate" title={source.payer}>{source.payer}</span>
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-1.5 text-green-700">
          <Clock className="w-3.5 h-3.5 text-green-500" />
          <span className="text-green-600">Checked:</span>
          <span className="font-medium">{formatTimestamp(source.timestamp)}</span>
        </div>

        {/* Format */}
        <div className="flex items-center gap-1.5 text-green-700">
          <FileCode className="w-3.5 h-3.5 text-green-500" />
          <span className="text-green-600">Format:</span>
          <span className="font-medium">{source.responseFormat}</span>
        </div>

        {/* Transaction ID */}
        {source.transactionId && (
          <div className="flex items-center gap-1.5 text-green-700">
            <span className="text-green-600">Transaction:</span>
            <span className="font-mono text-green-800 truncate" title={source.transactionId}>
              {source.transactionId.length > 12
                ? `${source.transactionId.slice(0, 12)}...`
                : source.transactionId}
            </span>
          </div>
        )}
      </div>

      {/* View Raw Response Link */}
      {onViewRawResponse && (
        <button
          onClick={onViewRawResponse}
          className="mt-2 flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View Raw Response
        </button>
      )}
    </div>
  );
}
