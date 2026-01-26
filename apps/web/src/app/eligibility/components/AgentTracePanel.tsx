'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Bot,
  Wrench,
  MessageSquare,
  Brain,
  Maximize2,
  X,
} from 'lucide-react';
import type { AgentStep } from '@eligibility-agent/shared';

interface AgentTracePanelProps {
  steps: AgentStep[];
  isRunning: boolean;
  streamingThinking?: string;
  streamingText?: string;
  compact?: boolean;
}

interface ToolStepProps {
  step: AgentStep;
  endStep?: AgentStep;
}

interface ThinkingStepProps {
  thinking: string;
  isStreaming?: boolean;
}

function ThinkingStep({ thinking, isStreaming }: ThinkingStepProps) {
  const [expanded, setExpanded] = useState(false);

  // Show preview (first ~100 chars)
  const preview = thinking.length > 100 ? thinking.slice(0, 100) + '...' : thinking;

  return (
    <div className="border border-primary-200 bg-primary-50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-primary-100 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-primary-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-primary-400 flex-shrink-0" />
        )}
        <Brain className="w-4 h-4 text-primary-500 flex-shrink-0" />
        <span className="text-sm font-medium text-primary-700 flex-grow">
          Reasoning
        </span>
        {isStreaming && (
          <Loader2 className="w-4 h-4 animate-spin text-primary-400 flex-shrink-0" />
        )}
      </button>

      {!expanded && (
        <div className="px-3 pb-2 text-xs text-primary-600 italic truncate">
          {preview}
        </div>
      )}

      {expanded && (
        <div className="border-t border-primary-200 p-3 bg-white">
          <pre className="text-xs text-primary-800 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
            {thinking}
          </pre>
        </div>
      )}
    </div>
  );
}

function ToolStep({ step, endStep }: ToolStepProps) {
  const [expanded, setExpanded] = useState(false);
  const isComplete = !!endStep;
  const isSuccess = Boolean(endStep?.result && (endStep.result as { success?: boolean }).success !== false);

  // Format tool name for display
  const toolDisplayName = step.tool?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown Tool';

  // Get a brief summary of the result
  const getResultSummary = (): string => {
    if (!endStep?.result) return '';
    const result = endStep.result as { success?: boolean; data?: unknown; error?: string };
    if (!result.success && result.error) {
      return `Error: ${result.error.slice(0, 50)}${result.error.length > 50 ? '...' : ''}`;
    }
    if (result.data) {
      const data = result.data as Record<string, unknown>;
      // Extract key info based on tool type
      if (step.tool === 'lookup_npi' && data.firstName) {
        return `${data.firstName} ${data.lastName} (${data.specialty || 'Provider'})`;
      }
      if (step.tool === 'search_payers' && data.payers) {
        const payers = data.payers as Array<{ displayName: string }>;
        return `Found ${payers.length} payers`;
      }
      if (step.tool === 'check_eligibility' && data.status) {
        return `Status: ${data.status}`;
      }
      if (step.tool === 'get_payer_mapping') {
        return data.found ? `Found: ${data.stediPayerId}` : 'No mapping found';
      }
    }
    return isSuccess ? 'Success' : 'Failed';
  };

  return (
    <div className="border border-neutral-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-neutral-50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-neutral-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-neutral-400 flex-shrink-0" />
        )}
        <Wrench className="w-4 h-4 text-primary-500 flex-shrink-0" />
        <span className="text-sm font-medium text-neutral-700 truncate">
          {toolDisplayName}
        </span>
        <span className="text-xs text-neutral-500 truncate flex-grow">
          {getResultSummary()}
        </span>
        {!isComplete && (
          <Loader2 className="w-4 h-4 animate-spin text-primary-400 flex-shrink-0" />
        )}
        {isComplete && isSuccess && (
          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
        )}
        {isComplete && !isSuccess && (
          <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-neutral-200 p-2 bg-neutral-50 space-y-2">
          {step.input != null && (
            <div>
              <p className="text-xs font-medium text-neutral-500 mb-1">Input</p>
              <pre className="text-xs bg-white p-2 rounded border border-neutral-200 overflow-x-auto max-h-32">
                {JSON.stringify(step.input, null, 2)}
              </pre>
            </div>
          )}
          {endStep?.result != null && (
            <div>
              <p className="text-xs font-medium text-neutral-500 mb-1">Result</p>
              <pre className="text-xs bg-white p-2 rounded border border-neutral-200 overflow-x-auto max-h-48">
                {JSON.stringify(endStep.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextStep({ text }: { text: string }) {
  return (
    <div className="flex gap-2 items-start p-2 bg-blue-50 rounded-lg border border-blue-200">
      <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-blue-800 whitespace-pre-wrap">{text}</p>
    </div>
  );
}

export default function AgentTracePanel({
  steps,
  isRunning,
  streamingThinking,
  streamingText,
  compact = false,
}: AgentTracePanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Group tool_start and tool_end steps
  const toolSteps: { start: AgentStep; end?: AgentStep }[] = [];
  const orderedItems: Array<
    | { type: 'thinking'; step: AgentStep }
    | { type: 'text'; step: AgentStep }
    | { type: 'tool'; start: AgentStep; end?: AgentStep }
  > = [];

  for (const step of steps) {
    if (step.type === 'tool_start') {
      const toolStep = { start: step, end: undefined as AgentStep | undefined };
      toolSteps.push(toolStep);
      orderedItems.push({ type: 'tool', ...toolStep });
    } else if (step.type === 'tool_end') {
      // Find matching start
      const matching = toolSteps.find(ts => ts.start.tool === step.tool && !ts.end);
      if (matching) {
        matching.end = step;
        // Update the ordered item
        const idx = orderedItems.findIndex(
          item => item.type === 'tool' && item.start === matching.start
        );
        if (idx >= 0) {
          (orderedItems[idx] as { type: 'tool'; start: AgentStep; end?: AgentStep }).end = step;
        }
      }
    } else if (step.type === 'thinking' && step.thinking) {
      orderedItems.push({ type: 'thinking', step });
    } else if (step.type === 'text' && step.text) {
      orderedItems.push({ type: 'text', step });
    }
  }

  const hasContent = steps.length > 0 || isRunning || streamingThinking || streamingText;

  if (!hasContent) {
    return null;
  }

  const panelContent = (
    <>
      {/* Render ordered items */}
      {orderedItems.map((item, i) => {
        if (item.type === 'thinking') {
          return (
            <ThinkingStep
              key={item.step.id || i}
              thinking={item.step.thinking || ''}
            />
          );
        }
        if (item.type === 'text') {
          return <TextStep key={item.step.id || i} text={item.step.text || ''} />;
        }
        if (item.type === 'tool') {
          return (
            <ToolStep
              key={item.start.id || i}
              step={item.start}
              endStep={item.end}
            />
          );
        }
        return null;
      })}

      {/* Streaming thinking */}
      {streamingThinking && (
        <ThinkingStep thinking={streamingThinking} isStreaming />
      )}

      {/* Streaming text */}
      {streamingText && (
        <div className="flex gap-2 items-start p-2 bg-blue-50 rounded-lg border border-blue-200">
          <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-blue-800 whitespace-pre-wrap">{streamingText}</p>
          <Loader2 className="w-4 h-4 animate-spin text-blue-400 flex-shrink-0" />
        </div>
      )}

      {/* Initial loading state */}
      {isRunning && steps.length === 0 && !streamingThinking && !streamingText && (
        <div className="flex items-center gap-2 text-neutral-500 p-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Analyzing data...</span>
        </div>
      )}
    </>
  );

  // Expanded/fullscreen modal view
  if (isExpanded) {
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsExpanded(false)}
        />

        {/* Expanded panel */}
        <div className="fixed inset-4 md:inset-8 lg:inset-12 bg-white rounded-xl border border-neutral-200 overflow-hidden z-50 flex flex-col">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200 bg-neutral-50">
            <Bot className="w-5 h-5 text-primary-500" />
            <h3 className="text-base font-semibold text-neutral-700 flex-grow">Agent Activity</h3>
            {isRunning && (
              <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
            )}
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1.5 hover:bg-neutral-200 rounded-lg transition-colors"
              title="Close"
            >
              <X className="w-5 h-5 text-neutral-500" />
            </button>
          </div>

          <div className="flex-1 p-4 space-y-3 overflow-y-auto">
            {panelContent}
          </div>
        </div>
      </>
    );
  }

  // Compact view (default)
  return (
    <div className="bg-white rounded-xl border-2 border-primary-200 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary-100 bg-primary-50">
        <Bot className="w-4 h-4 text-primary-600" />
        <h3 className="text-sm font-semibold text-primary-700 flex-grow">Agent Activity</h3>
        {isRunning && (
          <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
        )}
        <button
          onClick={() => setIsExpanded(true)}
          className="p-1 hover:bg-primary-100 rounded transition-colors"
          title="Expand"
        >
          <Maximize2 className="w-4 h-4 text-primary-500" />
        </button>
      </div>

      <div className={`p-3 space-y-2 overflow-y-auto ${compact ? 'max-h-[300px]' : 'max-h-[500px]'}`}>
        {panelContent}
      </div>
    </div>
  );
}
