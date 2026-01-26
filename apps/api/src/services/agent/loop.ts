/**
 * Agent Loop for the Eligibility Agent
 *
 * Uses Anthropic SDK directly with tool use for eligibility verification.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentInput,
  AgentEvent,
  AgentUsage,
  EligibilityResponse,
  DiscrepancyReport,
} from '@eligibility-agent/shared';

import { ELIGIBILITY_SYSTEM_PROMPT, buildDataContext, AGENT_LIMITS } from './prompt.js';
import { executeTool } from './executor.js';

/**
 * Parsed agent output structure
 */
interface AgentOutput {
  summary?: string;
  discrepancies?: DiscrepancyReport;
  eligibility?: EligibilityResponse;
  rawResponse?: unknown;
}

// Tool definitions for Anthropic API
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'lookup_npi',
    description: 'Validate NPI format and lookup provider details from NPPES registry. Use this when you have an NPI and want to verify it or get provider details.',
    input_schema: {
      type: 'object',
      properties: {
        npi: { type: 'string', description: '10-digit NPI number to lookup' },
      },
      required: ['npi'],
    },
  },
  {
    name: 'search_npi',
    description: 'Search NPPES registry for providers by name. Use this when you need to find an NPI for a provider.',
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'Provider first name' },
        lastName: { type: 'string', description: 'Provider last name' },
        state: { type: 'string', description: '2-letter state code to narrow search' },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'search_payers',
    description: 'Search Stedi payer directory by name. Returns payer IDs needed for eligibility checks.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Payer name to search (fuzzy match supported)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_payer_mapping',
    description: 'Check if we have a known Stedi payer ID mapping for this payer name. Check this before searching.',
    input_schema: {
      type: 'object',
      properties: {
        payerName: { type: 'string', description: 'Payer name to lookup' },
      },
      required: ['payerName'],
    },
  },
  {
    name: 'save_payer_mapping',
    description: 'Save a successful payer name to Stedi ID mapping for future use.',
    input_schema: {
      type: 'object',
      properties: {
        payerName: { type: 'string', description: 'Original payer name from FHIR/user' },
        stediPayerId: { type: 'string', description: 'Stedi payer ID that worked' },
        stediPayerName: { type: 'string', description: 'Display name from Stedi' },
      },
      required: ['payerName', 'stediPayerId'],
    },
  },
  {
    name: 'check_eligibility',
    description: 'Submit X12 270 eligibility check to Stedi. Returns detailed coverage information. IMPORTANT: You must provide provider name (either organizationName OR firstName+lastName) - get this from the NPI lookup result.',
    input_schema: {
      type: 'object',
      properties: {
        stediPayerId: { type: 'string', description: 'Stedi payer ID (from search_payers or get_payer_mapping)' },
        memberId: { type: 'string', description: 'Insurance member ID' },
        patientFirstName: { type: 'string', description: 'Patient first name' },
        patientLastName: { type: 'string', description: 'Patient last name' },
        patientDob: { type: 'string', description: 'Patient date of birth (YYYY-MM-DD)' },
        providerNpi: { type: 'string', description: '10-digit provider NPI' },
        providerFirstName: { type: 'string', description: 'Provider first name (required if no organizationName)' },
        providerLastName: { type: 'string', description: 'Provider last name (required if no organizationName)' },
        providerOrganizationName: { type: 'string', description: 'Provider organization name (required if no firstName/lastName)' },
        serviceTypeCode: { type: 'string', description: 'Service type code (default: 30 for Health Benefit Plan Coverage)' },
        groupNumber: { type: 'string', description: 'Insurance group number if known' },
      },
      required: ['stediPayerId', 'memberId', 'patientFirstName', 'patientLastName', 'patientDob', 'providerNpi'],
    },
  },
  {
    name: 'discover_insurance',
    description: 'Find patient insurance coverage when payer is unknown. Slower (up to 120s). Use as last resort when you have no payer information. Requires provider NPI.',
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'Patient first name' },
        lastName: { type: 'string', description: 'Patient last name' },
        dateOfBirth: { type: 'string', description: 'Patient date of birth (YYYY-MM-DD)' },
        providerNpi: { type: 'string', description: '10-digit provider NPI (required for discovery)' },
        street: { type: 'string', description: 'Street address (improves accuracy)' },
        city: { type: 'string', description: 'City' },
        state: { type: 'string', description: '2-letter state code' },
        zipCode: { type: 'string', description: 'ZIP code (improves accuracy)' },
        ssn: { type: 'string', description: 'Last 4 digits of SSN (improves accuracy)' },
        gender: { type: 'string', enum: ['M', 'F'], description: 'Patient gender (M or F)' },
      },
      required: ['firstName', 'lastName', 'dateOfBirth', 'providerNpi'],
    },
  },
];

/**
 * Run the eligibility agent using Anthropic SDK directly.
 * Yields events for streaming to the client.
 */
export async function* runEligibilityAgent(
  input: AgentInput
): AsyncGenerator<AgentEvent> {
  const client = new Anthropic();

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

  // Track usage
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let eligibilityResult: EligibilityResponse | undefined;

  // Conversation messages
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: promptText },
  ];

  // Accumulate text output for parsing structured JSON at the end
  let accumulatedText = '';

  try {
    let turnCount = 0;
    const maxTurns = AGENT_LIMITS.MAX_TURNS;

    while (turnCount < maxTurns) {
      turnCount++;

      // Make API call
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: ELIGIBILITY_SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      // Track usage
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Process response content
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'thinking') {
          yield {
            type: 'thinking',
            thinking: block.thinking,
          };
        } else if (block.type === 'text') {
          accumulatedText += block.text;
          yield {
            type: 'text',
            text: block.text,
          };
        } else if (block.type === 'tool_use') {
          yield {
            type: 'tool_start',
            tool: block.name,
            input: block.input as Record<string, unknown>,
          };

          // Execute the tool
          let toolInput = block.input as Record<string, unknown>;

          // Special handling for discover_insurance
          if (block.name === 'discover_insurance') {
            toolInput = {
              firstName: toolInput.firstName,
              lastName: toolInput.lastName,
              dateOfBirth: toolInput.dateOfBirth,
              providerNpi: toolInput.providerNpi,
              address: toolInput.street ? {
                street: toolInput.street,
                city: toolInput.city,
                state: toolInput.state,
                zipCode: toolInput.zipCode,
              } : undefined,
              ssn: toolInput.ssn,
              gender: toolInput.gender,
            };
          }

          const result = await executeTool(block.name, toolInput);

          // Check if this is an eligibility result
          const resultData = result?.data as Record<string, unknown> | undefined;
          if (result?.success && resultData?.status) {
            eligibilityResult = resultData as unknown as EligibilityResponse;
          }

          yield {
            type: 'tool_end',
            tool: block.name,
            result,
          };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Add assistant response to messages
      messages.push({ role: 'assistant', content: response.content });

      // If there were tool calls, add the results and continue
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }

      // Check if we should stop
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
        break;
      }

      // If no tool use and not end_turn, something unexpected happened
      if (toolResults.length === 0 && response.stop_reason !== 'tool_use') {
        break;
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
