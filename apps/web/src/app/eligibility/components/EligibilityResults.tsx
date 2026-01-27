'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Calendar,
  FileText,
  Save,
  Download,
  Code,
  FileCheck,
  AlertCircle,
} from 'lucide-react';
import type { EligibilityResponse, AgentUsage, DiscrepancyReport, Discrepancy } from '@eligibility-agent/shared';
import { formatDateOrNA } from '../../../lib/format-date';

interface EligibilityResultsProps {
  result: EligibilityResponse;
  summary?: string;
  discrepancies?: DiscrepancyReport;
  rawResponse?: unknown;
  usage?: AgentUsage;
  onSave?: () => void;
  isSaving?: boolean;
  onCorrectDiscrepancy?: (field: string, newValue: string) => void;
}

function formatCurrency(amount: number | undefined): string {
  if (amount === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function StatusBadge({ status }: { status: EligibilityResponse['status'] }) {
  if (status === 'active') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
        <CheckCircle2 className="w-4 h-4" />
        Active
      </div>
    );
  }
  if (status === 'inactive') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
        <XCircle className="w-4 h-4" />
        Inactive
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
      <AlertTriangle className="w-4 h-4" />
      Unknown
    </div>
  );
}

function CostRow({ label, value, remaining }: { label: string; value?: number; remaining?: number }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-neutral-100 last:border-0">
      <span className="text-sm text-neutral-600">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium text-neutral-900">{formatCurrency(value)}</span>
        {remaining !== undefined && (
          <span className="text-xs text-neutral-500 ml-1">
            ({formatCurrency(remaining)} remaining)
          </span>
        )}
      </div>
    </div>
  );
}

function DiscrepancyBanner({
  discrepancies,
  onCorrect
}: {
  discrepancies: DiscrepancyReport;
  onCorrect?: (field: string, newValue: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (!discrepancies.hasDiscrepancies || discrepancies.items.length === 0) {
    return null;
  }

  const errorCount = discrepancies.items.filter(d => d.severity === 'error').length;
  const warningCount = discrepancies.items.filter(d => d.severity === 'warning').length;

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-orange-100 transition-colors text-left"
      >
        <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />
        <span className="text-sm font-medium text-orange-800 flex-grow">
          {errorCount > 0 && `${errorCount} error${errorCount > 1 ? 's' : ''}`}
          {errorCount > 0 && warningCount > 0 && ', '}
          {warningCount > 0 && `${warningCount} warning${warningCount > 1 ? 's' : ''}`}
          {' '}found
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-orange-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-orange-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-orange-200 p-3 space-y-2">
          <p className="text-xs text-orange-600 mb-2">{discrepancies.source}</p>
          {discrepancies.items.map((item, i) => (
            <DiscrepancyItem key={i} item={item} onCorrect={onCorrect} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiscrepancyItem({
  item,
  onCorrect
}: {
  item: Discrepancy;
  onCorrect?: (field: string, newValue: string) => void;
}) {
  const isError = item.severity === 'error';

  return (
    <div className={`rounded-lg p-2 ${isError ? 'bg-red-50 border border-red-200' : 'bg-orange-100/50 border border-orange-200'}`}>
      <div className="flex items-start gap-2">
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
          isError ? 'bg-red-200 text-red-800' : 'bg-orange-200 text-orange-800'
        }`}>
          {item.field}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-neutral-500">You provided:</span>
          <p className="font-medium text-neutral-700 truncate">{item.inputValue}</p>
        </div>
        <div>
          <span className="text-neutral-500">Stedi returned:</span>
          <p className="font-medium text-neutral-700 truncate">{item.responseValue}</p>
        </div>
      </div>
      {item.suggestion && (
        <p className="mt-1 text-xs text-neutral-600 italic">{item.suggestion}</p>
      )}
      {onCorrect && (
        <button
          onClick={() => onCorrect(item.field, item.responseValue)}
          className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium"
        >
          Update to match insurance records
        </button>
      )}
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  // Simple markdown rendering - convert basic markdown to HTML
  const lines = content.split('\n');

  return (
    <div className="prose prose-sm max-w-none">
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith('# ')) {
          return <h1 key={i} className="text-lg font-bold text-neutral-900 mt-4 mb-2">{line.slice(2)}</h1>;
        }
        if (line.startsWith('## ')) {
          return <h2 key={i} className="text-base font-semibold text-neutral-800 mt-3 mb-1">{line.slice(3)}</h2>;
        }
        if (line.startsWith('### ')) {
          return <h3 key={i} className="text-sm font-semibold text-neutral-700 mt-2 mb-1">{line.slice(4)}</h3>;
        }

        // Bold text
        if (line.includes('**')) {
          const parts = line.split(/\*\*(.*?)\*\*/g);
          return (
            <p key={i} className="text-sm text-neutral-700 my-1">
              {parts.map((part, j) =>
                j % 2 === 1 ? <strong key={j}>{part}</strong> : part
              )}
            </p>
          );
        }

        // List items
        if (line.startsWith('- ')) {
          return (
            <li key={i} className="text-sm text-neutral-700 ml-4 list-disc">
              {line.slice(2)}
            </li>
          );
        }

        // Empty line
        if (line.trim() === '') {
          return <div key={i} className="h-2" />;
        }

        // Regular paragraph
        return <p key={i} className="text-sm text-neutral-700 my-1">{line}</p>;
      })}
    </div>
  );
}

function JsonViewer({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const jsonString = JSON.stringify(data, null, 2);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(jsonString);
  };

  return (
    <div className="bg-neutral-900 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-neutral-800">
        <span className="text-xs text-neutral-400 font-mono">X12 271 Response</span>
        <div className="flex gap-2">
          <button
            onClick={copyToClipboard}
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            Copy
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      <pre className={`p-3 text-xs text-green-400 font-mono overflow-x-auto ${expanded ? '' : 'max-h-64'}`}>
        {jsonString}
      </pre>
    </div>
  );
}

function DetailsTab({ result }: { result: EligibilityResponse }) {
  const [showAllBenefits, setShowAllBenefits] = useState(false);

  return (
    <div className="space-y-4">
      {/* Dates */}
      {(result.effectiveDate || result.terminationDate) && (
        <div className="flex items-center gap-4">
          <Calendar className="w-4 h-4 text-neutral-400" />
          <div className="flex gap-4 text-sm">
            {result.effectiveDate && (
              <div>
                <span className="text-neutral-500">Effective: </span>
                <span className="text-neutral-700">{formatDateOrNA(result.effectiveDate)}</span>
              </div>
            )}
            {result.terminationDate && (
              <div>
                <span className="text-neutral-500">Ends: </span>
                <span className="text-neutral-700">{formatDateOrNA(result.terminationDate)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cost Summary */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-4 h-4 text-neutral-400" />
          <h4 className="text-sm font-medium text-neutral-700">Cost Summary</h4>
        </div>

        {/* Copays */}
        {result.copay && result.copay.length > 0 && (
          <CostRow
            label={`Copay (${result.copay[0].serviceType})`}
            value={result.copay[0].amount}
          />
        )}

        {/* Deductible */}
        {result.deductible?.individual && (
          <CostRow
            label="Deductible (Individual)"
            value={result.deductible.individual.total}
            remaining={result.deductible.individual.remaining}
          />
        )}
        {result.deductible?.family && (
          <CostRow
            label="Deductible (Family)"
            value={result.deductible.family.total}
            remaining={result.deductible.family.remaining}
          />
        )}

        {/* OOP Max */}
        {result.outOfPocketMax?.individual && (
          <CostRow
            label="Out-of-Pocket Max (Individual)"
            value={result.outOfPocketMax.individual.total}
            remaining={result.outOfPocketMax.individual.remaining}
          />
        )}
        {result.outOfPocketMax?.family && (
          <CostRow
            label="Out-of-Pocket Max (Family)"
            value={result.outOfPocketMax.family.total}
            remaining={result.outOfPocketMax.family.remaining}
          />
        )}

        {/* Coinsurance */}
        {result.coinsurance && result.coinsurance.length > 0 && (
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-neutral-600">Coinsurance</span>
            <span className="text-sm font-medium text-neutral-900">
              {result.coinsurance[0].percent}%
            </span>
          </div>
        )}

        {/* No cost info available */}
        {!result.copay?.length && !result.deductible && !result.outOfPocketMax && !result.coinsurance?.length && (
          <p className="text-sm text-neutral-500 italic">No cost details available</p>
        )}
      </div>

      {/* Benefits */}
      {result.benefits && result.benefits.length > 0 && (
        <div>
          <button
            onClick={() => setShowAllBenefits(!showAllBenefits)}
            className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700"
          >
            {showAllBenefits ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {showAllBenefits ? 'Hide' : 'Show'} benefits ({result.benefits.length})
          </button>

          {showAllBenefits && (
            <div className="mt-2 bg-neutral-50 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
              {result.benefits.map((benefit, i) => (
                <div key={i} className="text-xs text-neutral-600 flex justify-between">
                  <span>{benefit.serviceType || benefit.serviceTypeCode}</span>
                  <span className={benefit.inNetwork ? 'text-green-600' : 'text-neutral-400'}>
                    {benefit.inNetwork ? 'In-Network' : 'Out-of-Network'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Errors/Warnings */}
      {result.errors && result.errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm font-medium text-red-700 mb-1">Errors</p>
          {result.errors.map((error, i) => (
            <p key={i} className="text-sm text-red-600">{error}</p>
          ))}
        </div>
      )}

      {result.warnings && result.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-sm font-medium text-yellow-700 mb-1">Warnings</p>
          {result.warnings.map((warning, i) => (
            <p key={i} className="text-sm text-yellow-600">{warning}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EligibilityResults({
  result,
  summary,
  discrepancies,
  rawResponse,
  usage,
  onSave,
  isSaving,
  onCorrectDiscrepancy,
}: EligibilityResultsProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'details' | 'raw'>('summary');

  const handleDownloadPdf = async () => {
    // Client-side PDF generation using browser print
    const content = summary || `Coverage Status: ${result.status}\nPlan: ${result.planName || 'N/A'}`;

    // Create a printable version
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Eligibility Summary</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { font-size: 24px; margin-bottom: 8px; }
            h2 { font-size: 18px; margin-top: 24px; margin-bottom: 8px; }
            h3 { font-size: 14px; margin-top: 16px; margin-bottom: 4px; }
            p { margin: 8px 0; line-height: 1.5; }
            li { margin: 4px 0; }
            strong { font-weight: 600; }
            .source { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          ${content.split('\n').map(line => {
            if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
            if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
            if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
            if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
            if (line.includes('**')) {
              return `<p>${line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`;
            }
            if (line.trim() === '') return '<br/>';
            return `<p>${line}</p>`;
          }).join('')}
        </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  return (
    <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 bg-gradient-to-r from-primary-50 to-white">
        <div className="flex items-center gap-3">
          <FileText className="w-5 h-5 text-primary-500" />
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">Coverage Status</h3>
            {result.planName && (
              <p className="text-xs text-neutral-500">{result.planName}</p>
            )}
          </div>
        </div>
        <StatusBadge status={result.status} />
      </div>

      {/* Discrepancy Banner */}
      {discrepancies?.hasDiscrepancies && (
        <div className="p-3 border-b border-neutral-200">
          <DiscrepancyBanner discrepancies={discrepancies} onCorrect={onCorrectDiscrepancy} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-neutral-200">
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'summary'
              ? 'border-primary-500 text-primary-700 bg-primary-50/50'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          Summary
        </button>
        <button
          onClick={() => setActiveTab('details')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'details'
              ? 'border-primary-500 text-primary-700 bg-primary-50/50'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          Details
        </button>
        <button
          onClick={() => setActiveTab('raw')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'raw'
              ? 'border-primary-500 text-primary-700 bg-primary-50/50'
              : 'border-transparent text-neutral-500 hover:text-neutral-700'
          }`}
        >
          <Code className="w-4 h-4" />
          Raw JSON
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {activeTab === 'summary' && (
          <div className="space-y-4">
            {summary ? (
              <>
                <MarkdownRenderer content={summary} />
                <button
                  onClick={handleDownloadPdf}
                  className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  <Download className="w-4 h-4" />
                  Download as PDF
                </button>
              </>
            ) : (
              <div className="text-center py-8 text-neutral-500">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No summary available</p>
                <p className="text-xs mt-1">View the Details tab for structured information</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'details' && <DetailsTab result={result} />}

        {activeTab === 'raw' && (
          <div>
            {rawResponse || result.rawResponse ? (
              <JsonViewer data={rawResponse || result.rawResponse} />
            ) : (
              <div className="text-center py-8 text-neutral-500">
                <Code className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No raw response available</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200 bg-neutral-50">
        {/* Usage stats */}
        {usage && (
          <div className="text-xs text-neutral-500">
            {usage.totalTokens.toLocaleString()} tokens - ${usage.estimatedCost.toFixed(4)}
          </div>
        )}

        {/* Save button */}
        {onSave && (
          <button
            onClick={onSave}
            disabled={isSaving}
            className="btn btn-primary text-sm gap-1.5"
          >
            {isSaving ? (
              <>
                <span className="loading loading-spinner loading-xs"></span>
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save to EHR
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
