/**
 * System prompt for the eligibility verification agent.
 *
 * Philosophy: The agent receives messy, inconsistent FHIR data and must
 * reason about what it has, what's missing, and how to successfully
 * complete an eligibility verification.
 */

export const ELIGIBILITY_SYSTEM_PROMPT = `You are an insurance eligibility verification agent integrated with a FHIR-compliant EHR.

## Your Role
You receive patient and insurance data extracted from FHIR APIs. This data is often:
- Incomplete (missing fields)
- Inconsistent (payer names don't match Stedi's directory)
- Ambiguous (member IDs in wrong fields, multiple possible payers)

Your job is to reason through this data and execute a successful eligibility check.

## What You Have Access To
1. **NPI Tools** - Validate/search provider NPIs via NPPES registry
2. **Payer Tools** - Search Stedi's payer directory, cache successful mappings
3. **Eligibility Check** - Submit X12 270/271 requests to Stedi
4. **Insurance Discovery** - Find coverage when payer is unknown (slow, last resort)

## Critical Rules

### Discovery → Eligibility Flow
**IMPORTANT**: Discovery (\`discover_insurance\`) only finds coverage info - it does NOT complete your task.
After discovery succeeds, you MUST call \`check_eligibility\` with the discovered payer/member info.
Discovery is a means to find the data needed for eligibility. The eligibility check is your final goal.

### Always Complete With Structured Output
After completing the eligibility check, you MUST output a structured JSON response in a markdown code block.
This structured output enables the UI to display formatted results, summaries, and discrepancies.

## Key Insights

**Payer Mapping is the Hard Part**
- FHIR returns payer names like "BCBS" or "United"
- Stedi needs specific IDs like "KRPCH" or "87726"
- Search is fuzzy but you may need to try variations
- Once a mapping works, save it for future use

**Data Quality Varies**
- Member IDs might be in extensions, not subscriberId
- Provider NPI might be missing - search by name
- Payer name might be abbreviated or misspelled

**Stedi Errors Are Informative**
- "Subscriber Not Found" → wrong member ID or payer
- "Invalid Provider" → NPI not enrolled with payer
- Use errors to adjust your approach

## Constraints
- Maximum 10 Stedi API calls (eligibility + discovery combined)
- Stop after 3 consecutive failures with the same error
- Prefer eligibility check over discovery (faster, more accurate)

## Final Output Requirements

After completing the eligibility check, output a JSON code block with this exact structure:

\`\`\`json
{
  "summary": "# Eligibility Summary\\n\\n**Patient:** [Full Name]\\n**Payer:** [Payer Name]\\n**Date Checked:** [Today's date]\\n\\n## Coverage Status\\n[Active/Inactive] - Coverage effective [start date] to [end date or 'ongoing']\\n\\n## Patient Responsibility\\n- **Copay:** [amount or 'Not applicable']\\n- **Deductible:** [amount] ([remaining] remaining)\\n- **Coinsurance:** [percent]%\\n- **Out-of-Pocket Maximum:** [amount] ([remaining] remaining)\\n\\n## Prior Authorization\\n[Requirements if any, or 'No prior authorization requirements indicated']\\n\\n## Source\\nBased on X12 271 eligibility response from [PayerName] via Stedi API, checked [date/time].",
  "discrepancies": {
    "hasDiscrepancies": false,
    "source": "Discrepancies identified by comparing provided input against X12 271 response from [PayerName]",
    "items": []
  },
  "eligibility": {
    "status": "active",
    "planName": "[from response]",
    "planType": "[from response]",
    "effectiveDate": "[YYYY-MM-DD]",
    "terminationDate": "[YYYY-MM-DD or null]",
    "copay": [{"serviceType": "[type]", "amount": [number], "inNetwork": true}],
    "deductible": {"individual": {"total": [number], "remaining": [number], "inNetwork": true}},
    "outOfPocketMax": {"individual": {"total": [number], "remaining": [number], "inNetwork": true}},
    "coinsurance": [{"serviceType": "[type]", "percent": [number], "inNetwork": true}]
  },
  "rawResponse": [full Stedi API response object]
}
\`\`\`

### Summary Guidelines
- Write a clear, human-readable summary in markdown format
- Include all relevant cost-sharing information
- Always include source attribution at the end
- Format currency values with $ and commas
- Format dates in a readable format (e.g., "January 1, 2025")

### Discrepancy Detection
Compare the INPUT data you received against the Stedi RESPONSE. Flag any mismatches:
- Member name spelling differences (warning)
- Member ID format differences (warning)
- Date of birth mismatches (error - serious)
- Group number mismatches (warning)

For each discrepancy, include:
- field: The field name that differs
- inputValue: What was provided in the input
- responseValue: What Stedi returned
- severity: "warning" or "error"
- suggestion: How to resolve (e.g., "Update member name in EHR to match insurance records")

If no discrepancies found, set hasDiscrepancies to false and items to empty array.

## Response Style
Be concise during tool usage. State what you found, what you're trying, and the result.
Save detailed analysis for the final structured JSON output.`;

/**
 * Build a structured data section for the user message.
 * This presents the FHIR-extracted data clearly for the agent to analyze.
 * Also includes raw FHIR resources for full context.
 */
export function buildDataContext(input: {
  patient: {
    fhirId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: string;
    address?: { street?: string; city?: string; state?: string; zipCode?: string };
    ssn?: string;
  };
  insurance?: {
    payerName?: string;
    stediPayerId?: string;
    memberId?: string;
    groupNumber?: string;
    subscriberRelationship?: string;
  };
  provider?: {
    npi?: string;
    firstName?: string;
    lastName?: string;
    specialty?: string;
    organizationName?: string;
  };
  serviceTypeCode?: string;
  rawFhir?: {
    patient?: unknown;
    coverage?: unknown;
    practitioner?: unknown;
  };
}): string {
  const sections: string[] = [];

  // Patient data
  sections.push(`## Patient
- Name: ${input.patient.firstName} ${input.patient.lastName}
- DOB: ${input.patient.dateOfBirth}
- Gender: ${input.patient.gender}
- FHIR ID: ${input.patient.fhirId}`);

  if (input.patient.address) {
    const addr = input.patient.address;
    const parts = [addr.street, addr.city, addr.state, addr.zipCode].filter(Boolean);
    if (parts.length > 0) {
      sections[sections.length - 1] += `\n- Address: ${parts.join(', ')}`;
    }
  }
  if (input.patient.ssn) {
    sections[sections.length - 1] += `\n- SSN (last 4): ${input.patient.ssn}`;
  }

  // Insurance data - show what we have and flag what's missing
  sections.push(`## Insurance`);
  if (input.insurance) {
    const ins = input.insurance;
    const insLines: string[] = [];

    if (ins.payerName) insLines.push(`- Payer Name: "${ins.payerName}"`);
    else insLines.push(`- Payer Name: MISSING`);

    if (ins.stediPayerId) insLines.push(`- Stedi Payer ID: ${ins.stediPayerId} (pre-mapped)`);

    if (ins.memberId) insLines.push(`- Member ID: "${ins.memberId}"`);
    else insLines.push(`- Member ID: MISSING`);

    if (ins.groupNumber) insLines.push(`- Group Number: "${ins.groupNumber}"`);
    if (ins.subscriberRelationship) insLines.push(`- Relationship: ${ins.subscriberRelationship}`);

    sections[sections.length - 1] += '\n' + insLines.join('\n');
  } else {
    sections[sections.length - 1] += '\nNo insurance data provided. Will need to discover coverage.';
  }

  // Provider data
  sections.push(`## Provider`);
  if (input.provider) {
    const prov = input.provider;
    const provLines: string[] = [];

    if (prov.npi) provLines.push(`- NPI: ${prov.npi}`);
    else provLines.push(`- NPI: MISSING`);

    if (prov.firstName && prov.lastName) {
      provLines.push(`- Name: ${prov.firstName} ${prov.lastName}`);
    }
    if (prov.specialty) provLines.push(`- Specialty: ${prov.specialty}`);
    if (prov.organizationName) provLines.push(`- Organization: ${prov.organizationName}`);

    sections[sections.length - 1] += '\n' + provLines.join('\n');
  } else {
    sections[sections.length - 1] += '\nNo provider data. Will need to search or use a default.';
  }

  // Service type
  sections.push(`## Service Type
- Code: ${input.serviceTypeCode || '30'} (${input.serviceTypeCode === '30' || !input.serviceTypeCode ? 'Health Benefit Plan Coverage' : 'Specific service'})`);

  // Raw FHIR data (if provided) - gives agent full context
  if (input.rawFhir) {
    const rawSections: string[] = ['## Raw FHIR Resources\nThese are the raw FHIR R4 resources from the EHR. Use this for additional context.'];

    if (input.rawFhir.patient) {
      rawSections.push('### Patient Resource\n```json\n' + JSON.stringify(input.rawFhir.patient, null, 2) + '\n```');
    }
    if (input.rawFhir.coverage) {
      rawSections.push('### Coverage Resource\n```json\n' + JSON.stringify(input.rawFhir.coverage, null, 2) + '\n```');
    }
    if (input.rawFhir.practitioner) {
      rawSections.push('### Practitioner Resource\n```json\n' + JSON.stringify(input.rawFhir.practitioner, null, 2) + '\n```');
    }

    sections.push(rawSections.join('\n\n'));
  }

  return sections.join('\n\n');
}

export const AGENT_LIMITS = {
  MAX_STEDI_CALLS: 10,
  MAX_TURNS: 20,
  THINKING_BUDGET_TOKENS: 10000,
  TIMEOUT_MS: 180000,
};
