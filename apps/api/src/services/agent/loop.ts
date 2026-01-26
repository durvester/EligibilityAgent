/**
 * Agent Loop for the Eligibility Agent
 *
 * Uses Claude Agent SDK with custom MCP tools for eligibility verification.
 */

import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  AgentInput,
  AgentEvent,
  AgentUsage,
  EligibilityResponse,
  DiscrepancyReport,
} from '@eligibility-agent/shared';

/**
 * Parsed agent output structure
 */
interface AgentOutput {
  summary?: string;
  discrepancies?: DiscrepancyReport;
  eligibility?: EligibilityResponse;
  rawResponse?: unknown;
}
import { ELIGIBILITY_SYSTEM_PROMPT, buildDataContext, AGENT_LIMITS } from './prompt.js';
import { executeTool } from './executor.js';

/**
 * Create MCP server with eligibility tools
 */
function createEligibilityTools() {
  return createSdkMcpServer({
    name: 'eligibility-tools',
    version: '1.0.0',
    tools: [
      // NPI Lookup Tool
      tool(
        'lookup_npi',
        'Validate NPI format and lookup provider details from NPPES registry. Use this when you have an NPI and want to verify it or get provider details.',
        {
          npi: z.string().describe('10-digit NPI number to lookup'),
        },
        async (args) => {
          const result = await executeTool('lookup_npi', args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      ),

      // NPI Search Tool
      tool(
        'search_npi',
        'Search NPPES registry for providers by name. Use this when you need to find an NPI for a provider.',
        {
          firstName: z.string().describe('Provider first name'),
          lastName: z.string().describe('Provider last name'),
          state: z.string().optional().describe('2-letter state code to narrow search'),
        },
        async (args) => {
          const result = await executeTool('search_npi', args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      ),

      // Payer Search Tool
      tool(
        'search_payers',
        'Search Stedi payer directory by name. Returns payer IDs needed for eligibility checks.',
        {
          query: z.string().describe('Payer name to search (fuzzy match supported)'),
        },
        async (args) => {
          const result = await executeTool('search_payers', args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      ),

      // Get Payer Mapping Tool
      tool(
        'get_payer_mapping',
        'Check if we have a known Stedi payer ID mapping for this payer name. Check this before searching.',
        {
          payerName: z.string().describe('Payer name to lookup'),
        },
        async (args) => {
          const result = await executeTool('get_payer_mapping', args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      ),

      // Save Payer Mapping Tool
      tool(
        'save_payer_mapping',
        'Save a successful payer name to Stedi ID mapping for future use.',
        {
          payerName: z.string().describe('Original payer name from FHIR/user'),
          stediPayerId: z.string().describe('Stedi payer ID that worked'),
          stediPayerName: z.string().optional().describe('Display name from Stedi'),
        },
        async (args) => {
          const result = await executeTool('save_payer_mapping', args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      ),

      // Check Eligibility Tool
      tool(
        'check_eligibility',
        'Submit X12 270 eligibility check to Stedi. Returns detailed coverage information. IMPORTANT: You must provide provider name (either organizationName OR firstName+lastName) - get this from the NPI lookup result.',
        {
          stediPayerId: z.string().describe('Stedi payer ID (from search_payers or get_payer_mapping)'),
          memberId: z.string().describe('Insurance member ID'),
          patientFirstName: z.string().describe('Patient first name'),
          patientLastName: z.string().describe('Patient last name'),
          patientDob: z.string().describe('Patient date of birth (YYYY-MM-DD)'),
          providerNpi: z.string().describe('10-digit provider NPI'),
          providerFirstName: z.string().optional().describe('Provider first name (required if no organizationName)'),
          providerLastName: z.string().optional().describe('Provider last name (required if no organizationName)'),
          providerOrganizationName: z.string().optional().describe('Provider organization name (required if no firstName/lastName)'),
          serviceTypeCode: z.string().optional().describe('Service type code (default: 30 for Health Benefit Plan Coverage)'),
          groupNumber: z.string().optional().describe('Insurance group number if known'),
        },
        async (args) => {
          const result = await executeTool('check_eligibility', args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      ),

      // Insurance Discovery Tool
      tool(
        'discover_insurance',
        'Find patient insurance coverage when payer is unknown. Slower (up to 120s). Use as last resort when you have no payer information. Requires provider NPI.',
        {
          firstName: z.string().describe('Patient first name'),
          lastName: z.string().describe('Patient last name'),
          dateOfBirth: z.string().describe('Patient date of birth (YYYY-MM-DD)'),
          providerNpi: z.string().describe('10-digit provider NPI (required for discovery)'),
          street: z.string().optional().describe('Street address (improves accuracy)'),
          city: z.string().optional().describe('City'),
          state: z.string().optional().describe('2-letter state code'),
          zipCode: z.string().optional().describe('ZIP code (improves accuracy)'),
          ssn: z.string().optional().describe('Last 4 digits of SSN (improves accuracy)'),
          gender: z.enum(['M', 'F']).optional().describe('Patient gender (M or F)'),
        },
        async (args) => {
          const result = await executeTool('discover_insurance', {
            firstName: args.firstName,
            lastName: args.lastName,
            dateOfBirth: args.dateOfBirth,
            providerNpi: args.providerNpi,
            address: args.street ? {
              street: args.street,
              city: args.city,
              state: args.state,
              zipCode: args.zipCode,
            } : undefined,
            ssn: args.ssn,
            gender: args.gender,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        }
      ),
    ],
  });
}

/**
 * Run the eligibility agent using Claude Agent SDK.
 * Yields events for streaming to the client.
 */
export async function* runEligibilityAgent(
  input: AgentInput
): AsyncGenerator<AgentEvent> {
  // Build structured data context
  const dataContext = buildDataContext({
    patient: {
      fhirId: input.patient.fhirId,
      firstName: input.patient.firstName,
      lastName: input.patient.lastName,
      dateOfBirth: input.patient.dateOfBirth,
      gender: input.patient.gender,
      address: input.patient.address,
      ssn: input.patient.ssn,
    },
    insurance: input.insurance ? {
      payerName: input.insurance.payerName,
      stediPayerId: input.insurance.stediPayerId,
      memberId: input.insurance.memberId,
      groupNumber: input.insurance.groupNumber,
      subscriberRelationship: input.insurance.subscriberRelationship,
    } : undefined,
    provider: input.provider ? {
      npi: input.provider.npi,
      firstName: input.provider.firstName,
      lastName: input.provider.lastName,
      specialty: input.provider.specialty,
      organizationName: input.provider.organizationName,
    } : undefined,
    serviceTypeCode: input.serviceTypeCode,
    rawFhir: input.rawFhir,
  });

  // Build the prompt text
  const promptText = `# Eligibility Verification Request

${dataContext}

---

${input.cardImage ? 'An insurance card image is attached. Extract payer name, member ID, and group number from it to supplement the FHIR data above.\n\n' : ''}Analyze this data and perform an eligibility check. Think through what you have, what's missing, and your approach before taking action.`;

  // Create MCP server with our tools
  const eligibilityServer = createEligibilityTools();

  // Track usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let eligibilityResult: EligibilityResponse | undefined;

  // Track tool_use_id -> tool_name mapping for matching tool_start/tool_end
  const toolUseIdToName = new Map<string, string>();

  // Accumulate text output for parsing structured JSON at the end
  let accumulatedText = '';

  // Create async generator for streaming input mode (REQUIRED for MCP tools)
  // Per SDK docs: generator yields message(s), then completes. SDK handles the rest.
  async function* generateMessages() {
    yield {
      type: 'user' as const,
      message: {
        role: 'user' as const,
        content: promptText,
      },
    };
  }

  try {
    // Use streaming input mode (required for MCP servers/custom tools)
    for await (const message of query({
      // Cast to any to work around SDK type strictness - runtime works correctly
      prompt: generateMessages() as any,
      options: {
        systemPrompt: ELIGIBILITY_SYSTEM_PROMPT,
        mcpServers: {
          'eligibility-tools': eligibilityServer,
        },
        maxTurns: AGENT_LIMITS.MAX_TURNS,
        maxThinkingTokens: AGENT_LIMITS.THINKING_BUDGET_TOKENS,
        model: 'claude-sonnet-4-20250514',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (message.type === 'assistant') {
        // Process assistant message content
        const msg = message as any;
        const content = msg.message?.content || msg.content;

        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block !== null) {
              if ('type' in block && block.type === 'thinking' && 'thinking' in block) {
                yield {
                  type: 'thinking',
                  thinking: String(block.thinking),
                };
              } else if ('type' in block && block.type === 'text' && 'text' in block) {
                const textContent = String(block.text);
                accumulatedText += textContent;
                yield {
                  type: 'text',
                  text: textContent,
                };
              } else if ('type' in block && block.type === 'tool_use' && 'name' in block) {
                const toolName = String(block.name);
                const toolId = 'id' in block ? String(block.id) : '';

                // Track the mapping so we can match tool_end events
                if (toolId) {
                  toolUseIdToName.set(toolId, toolName);
                }

                yield {
                  type: 'tool_start',
                  tool: toolName,
                  input: ('input' in block ? block.input : {}) as Record<string, unknown>,
                };
              }
            }
          }
        } else if (typeof content === 'string') {
          yield {
            type: 'text',
            text: content,
          };
        }
      } else if (message.type === 'user') {
        // Tool results come back as user messages
        const msg = message as any;
        const content = msg.message?.content || msg.content;

        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result') {
              // Get the tool name from our tracking map
              const toolUseId = 'tool_use_id' in block ? String(block.tool_use_id) : '';
              const toolName = toolUseIdToName.get(toolUseId) || 'unknown';

              // Parse the tool result to check for eligibility data
              try {
                const blockContent = 'content' in block ? block.content : '';
                const resultContent = typeof blockContent === 'string'
                  ? blockContent
                  : JSON.stringify(blockContent);
                const parsed = JSON.parse(resultContent);

                // Check if this is an eligibility result
                if (parsed?.success && parsed?.data?.status) {
                  eligibilityResult = parsed.data;
                }

                yield {
                  type: 'tool_end',
                  tool: toolName,
                  result: parsed,
                };
              } catch {
                yield {
                  type: 'tool_end',
                  tool: toolName,
                  result: 'content' in block ? block.content : null,
                };
              }
            }
          }
        }
      } else if (message.type === 'result') {
        // Final result
        const msg = message as any;

        if (msg.usage) {
          totalInputTokens = msg.usage.input_tokens || 0;
          totalOutputTokens = msg.usage.output_tokens || 0;
        }

        if (msg.subtype !== 'success' && msg.errors) {
          yield {
            type: 'error',
            message: (msg.errors as string[]).join('; '),
          };
          return;
        }
      }
    }

    // Parse agent's structured JSON output from accumulated text
    let agentOutput: AgentOutput | null = null;

    if (accumulatedText) {
      try {
        // Extract JSON from markdown code block or raw JSON
        const jsonMatch = accumulatedText.match(/```json\s*([\s\S]*?)\s*```/) ||
                          accumulatedText.match(/(\{[\s\S]*"summary"[\s\S]*"eligibility"[\s\S]*\})/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          agentOutput = {
            summary: parsed.summary,
            discrepancies: parsed.discrepancies,
            eligibility: parsed.eligibility,
            rawResponse: parsed.rawResponse,
          };
          console.log('[AgentLoop] Parsed structured output from agent');
        }
      } catch (e) {
        // Agent didn't provide valid structured output - fall back to tool result
        console.log('[AgentLoop] Could not parse structured output, using tool result');
      }
    }

    // Emit completion
    const usage: AgentUsage = {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCost: (totalInputTokens * 3.0 + totalOutputTokens * 15.0) / 1_000_000,
    };

    yield {
      type: 'complete',
      eligibilityResult: agentOutput?.eligibility || eligibilityResult,
      summary: agentOutput?.summary,
      discrepancies: agentOutput?.discrepancies,
      rawResponse: agentOutput?.rawResponse || eligibilityResult?.rawResponse,
      usage,
    };
  } catch (error) {
    yield {
      type: 'error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    };
  }
}
