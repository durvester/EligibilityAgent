'use client';

import { Suspense } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { History, Loader2, Play, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import PatientSummary from './components/PatientSummary';
import InsuranceForm from './components/InsuranceForm';
import ProviderInfo from './components/ProviderInfo';
import ServiceTypeSelect from './components/ServiceTypeSelect';
import AgentTracePanel from './components/AgentTracePanel';
import EligibilityResults from './components/EligibilityResults';
import { fetchSSE } from '@/lib/sse-client';
import type {
  PatientInfo,
  InsuranceInfo,
  ProviderInfo as ProviderInfoType,
  AgentEvent,
  AgentStep,
  EligibilityResponse,
  AgentUsage,
  DiscrepancyReport,
} from '@eligibility-agent/shared';

interface EligibilityState {
  patient: PatientInfo | null;
  insurance: InsuranceInfo | null;
  provider: ProviderInfoType | null;
  serviceTypeCode: string;
  rawFhir?: {
    patient?: unknown;
    coverage?: unknown;
    practitioner?: unknown;
  };
  isLoading: boolean;
  error: string | null;
}

interface AgentState {
  isRunning: boolean;
  steps: AgentStep[];
  streamingThinking: string;
  streamingText: string;
  result: EligibilityResponse | null;
  summary: string | null;
  discrepancies: DiscrepancyReport | null;
  rawResponse: unknown | null;
  usage: AgentUsage | null;
  error: string | null;
}

function EligibilityContent() {
  const searchParams = useSearchParams();
  const patientId = searchParams.get('patient');

  const [state, setState] = useState<EligibilityState>({
    patient: null,
    insurance: null,
    provider: null,
    serviceTypeCode: '30',
    isLoading: true,
    error: null,
  });

  const [agentState, setAgentState] = useState<AgentState>({
    isRunning: false,
    steps: [],
    streamingThinking: '',
    streamingText: '',
    result: null,
    summary: null,
    discrepancies: null,
    rawResponse: null,
    usage: null,
    error: null,
  });

  const [showHistory, setShowHistory] = useState(false);
  const [isIframe, setIsIframe] = useState(true); // Default to iframe (compact) mode
  const abortControllerRef = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Detect if running in iframe
  useEffect(() => {
    try {
      setIsIframe(window.self !== window.top);
    } catch {
      // Cross-origin iframe detection - if we can't access window.top, we're in an iframe
      setIsIframe(true);
    }
  }, []);

  // Fetch patient data on mount using cookie-based auth
  useEffect(() => {
    async function fetchPatientData() {
      if (!patientId) {
        setState(s => ({ ...s, isLoading: false, error: 'No patient context' }));
        return;
      }

      try {
        // First verify we have a valid session
        const authResponse = await fetch('/api/auth/me', {
          credentials: 'include',
        });

        if (!authResponse.ok) {
          setState(s => ({ ...s, isLoading: false, error: 'Not authenticated. Please launch from EHR.' }));
          return;
        }

        // Fetch patient data - session provides auth context via cookie
        const response = await fetch(`/api/fhir/patient/${patientId}`, {
          credentials: 'include',
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || 'Failed to fetch patient');
        }

        setState(s => ({
          ...s,
          patient: data.patient,
          insurance: data.insurance,
          provider: data.provider,
          rawFhir: data.rawFhir,
          isLoading: false,
        }));
      } catch (err) {
        setState(s => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load patient data',
        }));
      }
    }

    fetchPatientData();
  }, [patientId]);

  // Auto-scroll to results when agent completes (only in iframe/single-column mode)
  useEffect(() => {
    if (agentState.result && resultsRef.current && isIframe) {
      resultsRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [agentState.result, isIframe]);

  // Handle agent event
  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'start':
        // SSE connection established
        break;

      case 'thinking':
        if (event.thinking) {
          setAgentState(s => ({
            ...s,
            streamingThinking: s.streamingThinking + event.thinking,
          }));
        }
        break;

      case 'text':
        if (event.text) {
          setAgentState(s => ({
            ...s,
            streamingText: s.streamingText + event.text,
          }));
        }
        break;

      case 'tool_start':
        setAgentState(s => {
          const newSteps = [...s.steps];

          // Add thinking step if we have accumulated thinking
          if (s.streamingThinking) {
            newSteps.push({
              id: `${Date.now()}-thinking`,
              type: 'thinking',
              thinking: s.streamingThinking,
              timestamp: Date.now(),
            });
          }

          // Add text step if we have accumulated text
          if (s.streamingText) {
            newSteps.push({
              id: `${Date.now()}-text`,
              type: 'text',
              text: s.streamingText,
              timestamp: Date.now(),
            });
          }

          // Add tool_start step
          newSteps.push({
            id: `${Date.now()}-tool-start`,
            type: 'tool_start',
            tool: event.tool,
            input: event.input,
            timestamp: Date.now(),
          });

          return {
            ...s,
            steps: newSteps,
            streamingThinking: '',
            streamingText: '',
          };
        });
        break;

      case 'tool_end':
        setAgentState(s => ({
          ...s,
          steps: [
            ...s.steps,
            {
              id: `${Date.now()}-tool-end`,
              type: 'tool_end',
              toolUseId: event.toolUseId,
              tool: event.tool,
              input: event.input, // Include input from tool_end for display
              result: event.result,
              timestamp: Date.now(),
            },
          ],
        }));
        break;

      case 'complete':
        setAgentState(s => {
          const newSteps = [...s.steps];

          // Add any final thinking
          if (s.streamingThinking) {
            newSteps.push({
              id: `${Date.now()}-thinking-final`,
              type: 'thinking',
              thinking: s.streamingThinking,
              timestamp: Date.now(),
            });
          }

          // Add any final text
          if (s.streamingText) {
            newSteps.push({
              id: `${Date.now()}-text-final`,
              type: 'text',
              text: s.streamingText,
              timestamp: Date.now(),
            });
          }

          return {
            ...s,
            isRunning: false,
            steps: newSteps,
            streamingThinking: '',
            streamingText: '',
            result: event.eligibilityResult || null,
            summary: event.summary || null,
            discrepancies: event.discrepancies || null,
            rawResponse: event.rawResponse || null,
            usage: event.usage || null,
          };
        });
        break;

      case 'error':
        setAgentState(s => ({
          ...s,
          isRunning: false,
          error: event.message || 'An unknown error occurred',
        }));
        break;
    }
  }, []);

  // Run eligibility check
  const runEligibilityCheck = useCallback(async () => {
    if (!state.patient) {
      setAgentState(s => ({ ...s, error: 'Patient information is required' }));
      return;
    }

    // Reset agent state
    setAgentState({
      isRunning: true,
      steps: [],
      streamingThinking: '',
      streamingText: '',
      result: null,
      summary: null,
      discrepancies: null,
      rawResponse: null,
      usage: null,
      error: null,
    });

    // Create abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Use Route Handler proxy for SSE - this was the working approach
    // Route Handler at /api/agent/eligibility:
    // 1. Receives cookie from browser (same-origin)
    // 2. Forwards to API with cookie
    // 3. Uses TransformStream to pipe SSE response back
    // Cookie domain .eligibility.practicefusionpm.com works for both
    await fetchSSE<AgentEvent>(
      '/api/agent/eligibility',
      {
        patient: state.patient,
        insurance: state.insurance,
        provider: state.provider,
        serviceTypeCode: state.serviceTypeCode,
        rawFhir: state.rawFhir,
      },
      {
        signal: controller.signal,
        onEvent: handleAgentEvent,
        onError: (error) => {
          setAgentState(s => ({
            ...s,
            isRunning: false,
            error: error.message || 'Failed to run eligibility check',
          }));
        },
        onClose: () => {
          // Mark as not running if we haven't received a complete/error event
          setAgentState(s => {
            if (s.isRunning) {
              // Stream ended without complete event - check if we got a result
              if (s.result) {
                return { ...s, isRunning: false };
              }
              // Cancelled by user
              if (controller.signal.aborted) {
                return { ...s, isRunning: false, error: 'Eligibility check cancelled' };
              }
              // Unexpected close
              return { ...s, isRunning: false, error: 'Connection closed unexpectedly' };
            }
            return s;
          });
          abortControllerRef.current = null;
        },
      }
    );
  }, [state.patient, state.insurance, state.provider, state.serviceTypeCode, state.rawFhir, handleAgentEvent]);

  // Cancel eligibility check
  const cancelEligibilityCheck = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Save results to EHR
  const saveToEhr = useCallback(async () => {
    // TODO: Implement EHR write-back
    // This is a placeholder for future implementation
  }, []);

  if (state.isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary-400 mx-auto" />
          <p className="text-neutral-600">Loading patient data...</p>
        </div>
      </main>
    );
  }

  // Shared input form content
  const inputFormContent = (
    <>
      {/* Patient Section */}
      <PatientSummary patient={state.patient} />

      {/* Insurance Section */}
      <InsuranceForm
        insurance={state.insurance}
        onChange={(insurance) => setState(s => ({ ...s, insurance }))}
      />

      {/* Provider Section */}
      <ProviderInfo
        provider={state.provider}
        onChange={(provider) => setState(s => ({ ...s, provider }))}
      />

      {/* Service Type */}
      <ServiceTypeSelect
        value={state.serviceTypeCode}
        onChange={(code) => setState(s => ({ ...s, serviceTypeCode: code }))}
      />

      {/* Check Eligibility Button */}
      <div className="flex gap-2">
        {agentState.isRunning ? (
          <button
            onClick={cancelEligibilityCheck}
            className="btn btn-outline flex-grow gap-2 text-red-600 border-red-300 hover:bg-red-50"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        ) : (
          <button
            onClick={runEligibilityCheck}
            disabled={!state.patient}
            className="btn btn-primary flex-grow gap-2"
          >
            {agentState.result ? (
              <>
                <RefreshCw className="w-4 h-4" />
                Check Again
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Check Eligibility
              </>
            )}
          </button>
        )}
      </div>
    </>
  );

  // Shared results content
  const resultsContent = (
    <>
      {/* Agent Error */}
      {agentState.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700 text-sm">{agentState.error}</p>
        </div>
      )}

      {/* Agent Trace Panel */}
      <AgentTracePanel
        steps={agentState.steps}
        isRunning={agentState.isRunning}
        streamingThinking={agentState.streamingThinking}
        streamingText={agentState.streamingText}
        compact={isIframe}
      />

      {/* Eligibility Results */}
      {agentState.result && (
        <div ref={resultsRef}>
          <EligibilityResults
            result={agentState.result}
            summary={agentState.summary || undefined}
            discrepancies={agentState.discrepancies || undefined}
            rawResponse={agentState.rawResponse || undefined}
            usage={agentState.usage || undefined}
            onSave={saveToEhr}
          />
        </div>
      )}
    </>
  );

  return (
    <main className="min-h-screen bg-neutral-50 p-3 sm:p-4 md:p-6">
      <div className={cn(
        "mx-auto",
        isIframe
          ? "max-w-lg space-y-3 sm:space-y-4"  // Compact single-column for iframe
          : "max-w-5xl"                         // Wider for standalone
      )}>
        {/* Header */}
        <div className={cn(
          "flex items-center justify-between",
          isIframe ? "mb-2" : "mb-4"
        )}>
          <div className="flex items-center gap-2">
            <div className={cn(
              "rounded-lg bg-primary-400 flex items-center justify-center",
              isIframe ? "w-6 h-6" : "w-8 h-8"
            )}>
              <span className={cn(
                "text-white font-bold",
                isIframe ? "text-xs" : "text-sm"
              )}>E</span>
            </div>
            <h1 className={cn(
              "font-semibold text-neutral-900",
              isIframe ? "text-sm" : "text-lg"
            )}>
              Eligibility Check
            </h1>
          </div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="btn btn-ghost text-xs gap-1.5 px-2 py-1"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">History</span>
          </button>
        </div>

        {state.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-700 text-sm">{state.error}</p>
          </div>
        )}

        {isIframe ? (
          // Single-column layout for iframe (existing compact layout)
          <div className="space-y-3">
            {inputFormContent}
            {resultsContent}
          </div>
        ) : (
          // Two-column layout for standalone mode
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Input Form */}
            <div className="space-y-4">
              {inputFormContent}
            </div>

            {/* Right: Results (sticky on large screens) */}
            <div className="lg:sticky lg:top-6 lg:self-start space-y-4">
              {resultsContent}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function EligibilityPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary-400 mx-auto" />
          <p className="text-neutral-600">Loading...</p>
        </div>
      </main>
    }>
      <EligibilityContent />
    </Suspense>
  );
}
