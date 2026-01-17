/**
 * Action Item Validation Service
 *
 * Implements strict validation system that enforces action item quality criteria
 * before items are added to Action Items section.
 *
 * Validation Criteria (ALL must be met):
 * 1. Clear Task: Must contain action verb + objective. Reject vague tasks.
 * 2. Subject-Related: Must score In-Scope (Important or Minor) against locked subject.
 * 3. Has Owner: Must have assignee name OR explicitly marked 'Need Assignment'.
 * 4. Has Deadline: Must have specific date (YYYY-MM-DD) OR 'TBD'.
 *
 * Items failing validation are moved to Tasks section with metadata about missing criteria.
 */

import { llmRoutingService } from './llm/llmRoutingService'
import type { ChatMessage } from './lm-studio-client'

// ============================================================================
// Types
// ============================================================================

export interface ValidationCriteria {
  hasClearTask: boolean
  hasOwner: boolean
  hasDeadline: boolean
  isSubjectRelated: boolean
}

export interface ValidationResult {
  isValid: boolean
  criteria: ValidationCriteria
  failureReasons: string[]
  metadata: {
    validationTimestamp: string
    processingTimeMs: number
    llmValidationUsed: boolean
  }
}

export interface ActionItemCandidate {
  task: string
  assignee: string | null
  deadline: string | null
  priority?: string | null
  context?: string | null
  speaker?: string | null
}

export interface SubjectContext {
  title: string | null
  goal: string | null
  scopeKeywords: string[]
}

// ============================================================================
// Constants
// ============================================================================

/** Action verbs that indicate clear tasks */
const ACTION_VERBS = [
  'do', 'create', 'send', 'review', 'complete', 'update', 'implement',
  'write', 'prepare', 'schedule', 'contact', 'finalize', 'submit',
  'approve', 'analyze', 'develop', 'design', 'test', 'deploy',
  'configure', 'setup', 'install', 'document', 'research', 'investigate',
  'fix', 'resolve', 'address', 'handle', 'manage', 'coordinate',
  'organize', 'plan', 'draft', 'revise', 'edit', 'publish',
  'share', 'distribute', 'present', 'demonstrate', 'validate'
]

/** Vague task patterns to reject */
const VAGUE_PATTERNS = [
  /^\s*follow[\s-]?up\s/i,
  /^\s*check\s/i,
  /^\s*maybe\s/i,
  /^\s*think\s+about\s/i,
  /^\s*consider\s/i,
  /^\s*look\s+into\s/i,
  /^\s*see\s+if\s/i,
  /^\s*try\s+to\s/i
]

/** Vague deadline patterns to reject */
const VAGUE_DEADLINE_PATTERNS = [
  /\b(soon|later|eventually|sometime)\b/i,
  /\bnext\s+week\b/i,
  /\bnext\s+month\b/i,
  /\bin\s+the\s+future\b/i,
  /\bwhen\s+possible\b/i,
  /\bASAP\b/i
]

// ============================================================================
// LLM Validation Prompt
// ============================================================================

const VALIDATION_SYSTEM_PROMPT = `You are a strict action item validator. Your job is to determine if a proposed action item meets ALL quality criteria.

Analyze the action item against these STRICT criteria:

1. CLEAR TASK: Must contain an action verb (do, create, send, review, etc.) AND a specific objective.
   - REJECT: Vague tasks like "follow up", "check", "maybe", "think about"
   - ACCEPT: "Send contract to client", "Review Q4 budget", "Complete user testing"

2. HAS OWNER: Must have a specific assignee name OR explicitly marked "Need Assignment" or "TBD".
   - REJECT: Missing owner, unclear who should do it
   - ACCEPT: "John Smith", "Marketing Team", "Need Assignment"

3. HAS DEADLINE: Must have specific date (YYYY-MM-DD) OR "TBD".
   - REJECT: Vague deadlines like "soon", "later", "next week", "ASAP"
   - ACCEPT: "2024-03-15", "TBD", "2024-12-31"

4. SUBJECT-RELATED: Must be relevant to the meeting subject (if provided).
   - REJECT: Off-topic items, unrelated side conversations
   - ACCEPT: Items directly related to subject or supporting the goal

Respond with JSON ONLY in this format:
{
  "meetsAllCriteria": true/false,
  "hasClearTask": true/false,
  "hasOwner": true/false,
  "hasDeadline": true/false,
  "isSubjectRelated": true/false,
  "reasoning": "Brief explanation of the decision"
}`

function buildValidationPrompt(candidate: ActionItemCandidate, subject?: SubjectContext): string {
  let prompt = `Validate this action item candidate:

Task: "${candidate.task}"
Assignee: ${candidate.assignee || 'NOT SPECIFIED'}
Deadline: ${candidate.deadline || 'NOT SPECIFIED'}`

  if (subject) {
    prompt += `

Meeting Subject:
- Title: ${subject.title || 'Unknown'}
- Goal: ${subject.goal || 'Unknown'}
- Scope Keywords: ${subject.scopeKeywords.join(', ')}`
  }

  if (candidate.context) {
    prompt += `

Context: ${candidate.context}`
  }

  return prompt
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if task has a clear action verb and objective
 */
function hasClearTask(task: string): boolean {
  const normalizedTask = task.toLowerCase().trim()

  // Reject if task is too short
  if (normalizedTask.length < 5) {
    return false
  }

  // Reject vague patterns
  for (const pattern of VAGUE_PATTERNS) {
    if (pattern.test(normalizedTask)) {
      return false
    }
  }

  // Check for action verbs at the start or after common prefixes
  const words = normalizedTask.split(/\s+/)
  const firstWord = words[0]

  // Check if first word is an action verb
  if (ACTION_VERBS.includes(firstWord)) {
    return true
  }

  // Check if second word is an action verb (after "to", "should", "will", "need to", etc.)
  if (words.length >= 2) {
    const secondWord = words[1]
    const firstTwoWords = `${firstWord} ${secondWord}`

    if (
      ACTION_VERBS.includes(secondWord) &&
      (firstWord === 'to' || firstWord === 'should' || firstWord === 'will' ||
       firstWord === 'must' || firstWord === 'need' || firstWord === 'can')
    ) {
      return true
    }

    // Handle "need to", "have to"
    if (words.length >= 3 && ACTION_VERBS.includes(words[2])) {
      if (firstTwoWords === 'need to' || firstTwoWords === 'have to') {
        return true
      }
    }
  }

  // Check if any action verb appears in the task
  for (const verb of ACTION_VERBS) {
    const verbPattern = new RegExp(`\\b${verb}\\b`, 'i')
    if (verbPattern.test(normalizedTask)) {
      return true
    }
  }

  return false
}

/**
 * Check if assignee is specified or explicitly marked as TBD
 */
function hasOwner(assignee: string | null): boolean {
  if (!assignee) {
    return false
  }

  const normalized = assignee.trim().toLowerCase()

  // Empty or just whitespace
  if (normalized.length === 0) {
    return false
  }

  // Explicit TBD markers are acceptable
  if (
    normalized === 'tbd' ||
    normalized === 'need assignment' ||
    normalized === 'to be determined' ||
    normalized === 'unassigned'
  ) {
    return true
  }

  // Has an actual name/identifier
  return normalized.length >= 2
}

/**
 * Check if deadline is specific or explicitly marked as TBD
 */
function hasDeadline(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const normalized = deadline.trim().toLowerCase()

  // Empty or just whitespace
  if (normalized.length === 0) {
    return false
  }

  // Explicit TBD markers are acceptable
  if (normalized === 'tbd' || normalized === 'to be determined') {
    return true
  }

  // Reject vague deadline patterns
  for (const pattern of VAGUE_DEADLINE_PATTERNS) {
    if (pattern.test(normalized)) {
      return false
    }
  }

  // Check for ISO date format (YYYY-MM-DD)
  const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
  if (isoDatePattern.test(normalized)) {
    return true
  }

  // Check for other specific date formats
  const specificDatePatterns = [
    /^\d{1,2}\/\d{1,2}\/\d{4}$/,  // MM/DD/YYYY
    /^\d{4}\/\d{1,2}\/\d{1,2}$/,  // YYYY/MM/DD
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}$/i,
    /^\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$/i
  ]

  for (const pattern of specificDatePatterns) {
    if (pattern.test(normalized)) {
      return true
    }
  }

  // Check for specific day references (e.g., "Friday, March 15")
  const specificDayPattern = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i
  if (specificDayPattern.test(normalized)) {
    return true
  }

  return false
}

/**
 * Check if item is related to the subject
 * Uses basic keyword matching with relevance threshold
 */
function isSubjectRelated(
  task: string,
  context: string | null,
  subject: SubjectContext | null
): { related: boolean; score: number } {
  // If no subject is provided, assume it's related (pass-through for non-subject-aware extraction)
  if (!subject || !subject.title) {
    return { related: true, score: 1.0 }
  }

  const combinedText = `${task} ${context || ''}`.toLowerCase()
  const keywords = subject.scopeKeywords.map(k => k.toLowerCase())
  const title = (subject.title || '').toLowerCase()
  const goal = (subject.goal || '').toLowerCase()

  let matchCount = 0
  const totalKeywords = keywords.length

  // Check title match
  if (title && combinedText.includes(title)) {
    matchCount += 3 // Title match is heavily weighted
  }

  // Check goal match
  if (goal && combinedText.includes(goal)) {
    matchCount += 2 // Goal match is weighted
  }

  // Check keyword matches
  for (const keyword of keywords) {
    if (combinedText.includes(keyword)) {
      matchCount++
    }
  }

  // Calculate relevance score
  const maxPossibleScore = totalKeywords + 5 // keywords + title(3) + goal(2)
  const score = maxPossibleScore > 0 ? matchCount / maxPossibleScore : 0

  // Threshold: must score at least 0.3 to be considered related (aligned with balanced mode)
  const related = score >= 0.3

  return { related, score }
}

// ============================================================================
// Validation Service Class
// ============================================================================

class ActionItemValidationService {
  /**
   * Validate an action item candidate against all quality criteria
   *
   * @param candidate - The action item to validate
   * @param subject - Optional subject context for relevance checking
   * @param useLLM - Whether to use LLM for additional validation (default: false)
   */
  async validate(
    candidate: ActionItemCandidate,
    subject?: SubjectContext | null,
    useLLM: boolean = false
  ): Promise<ValidationResult> {
    const startTime = Date.now()

    // Run rule-based validation
    const clearTask = hasClearTask(candidate.task)
    const ownerCheck = hasOwner(candidate.assignee)
    const deadlineCheck = hasDeadline(candidate.deadline)
    const subjectCheck = isSubjectRelated(
      candidate.task,
      candidate.context || null,
      subject || null
    )

    const criteria: ValidationCriteria = {
      hasClearTask: clearTask,
      hasOwner: ownerCheck,
      hasDeadline: deadlineCheck,
      isSubjectRelated: subjectCheck.related
    }

    const failureReasons: string[] = []

    if (!clearTask) {
      failureReasons.push('Missing clear task with action verb')
    }
    if (!ownerCheck) {
      failureReasons.push('Missing owner/assignee')
    }
    if (!deadlineCheck) {
      failureReasons.push('Missing specific deadline')
    }
    if (!subjectCheck.related) {
      failureReasons.push(`Not subject-related (score: ${subjectCheck.score.toFixed(2)})`)
    }

    let isValid = Object.values(criteria).every(v => v === true)
    let llmValidationUsed = false

    // Optional LLM validation for edge cases
    if (useLLM && !isValid) {
      try {
        const llmResult = await this.validateWithLLM(candidate, subject || undefined)
        if (llmResult) {
          // LLM can override rule-based validation if it provides better reasoning
          // But only if the LLM says it passes ALL criteria
          if (llmResult.meetsAllCriteria) {
            isValid = true
            criteria.hasClearTask = llmResult.hasClearTask
            criteria.hasOwner = llmResult.hasOwner
            criteria.hasDeadline = llmResult.hasDeadline
            criteria.isSubjectRelated = llmResult.isSubjectRelated
            failureReasons.length = 0
            failureReasons.push(`LLM override: ${llmResult.reasoning}`)
          }
          llmValidationUsed = true
        }
      } catch (error) {
        // If LLM validation fails, continue with rule-based result
        console.error('LLM validation failed:', error)
      }
    }

    const processingTimeMs = Date.now() - startTime

    return {
      isValid,
      criteria,
      failureReasons,
      metadata: {
        validationTimestamp: new Date().toISOString(),
        processingTimeMs,
        llmValidationUsed
      }
    }
  }

  /**
   * Validate using LLM for more nuanced understanding
   */
  private async validateWithLLM(
    candidate: ActionItemCandidate,
    subject?: SubjectContext
  ): Promise<{
    meetsAllCriteria: boolean
    hasClearTask: boolean
    hasOwner: boolean
    hasDeadline: boolean
    isSubjectRelated: boolean
    reasoning: string
  } | null> {
    try {
      // Check if LLM is available
      const health = await llmRoutingService.checkHealth(false)
      if (!health.success || !health.data?.healthy) {
        return null
      }

      const userPrompt = buildValidationPrompt(candidate, subject)
      const messages: ChatMessage[] = [
        { role: 'system', content: VALIDATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ]

      const response = await llmRoutingService.chatCompletion({
        messages,
        maxTokens: 500,
        temperature: 0.1 // Very low temperature for consistent validation
      })

      if (!response.success || !response.data) {
        return null
      }

      const content = response.data.choices[0]?.message?.content
      if (!content) {
        return null
      }

      // Parse JSON response
      let jsonContent = content.trim()
      if (jsonContent.startsWith('```')) {
        const match = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (match) {
          jsonContent = match[1].trim()
        }
      }

      const result = JSON.parse(jsonContent)

      return {
        meetsAllCriteria: result.meetsAllCriteria === true,
        hasClearTask: result.hasClearTask === true,
        hasOwner: result.hasOwner === true,
        hasDeadline: result.hasDeadline === true,
        isSubjectRelated: result.isSubjectRelated === true,
        reasoning: result.reasoning || 'No reasoning provided'
      }
    } catch (error) {
      console.error('LLM validation error:', error)
      return null
    }
  }

  /**
   * Format validation failure message for storage
   */
  formatValidationFailure(result: ValidationResult): string {
    if (result.isValid) {
      return ''
    }

    const reasons = result.failureReasons.join(', ')
    return `Moved to Tasks: ${reasons}`
  }

  /**
   * Format action item for display
   * Format: [Owner] Task — Due: Date
   */
  formatActionItem(candidate: ActionItemCandidate): string {
    let formatted = ''

    // Add owner prefix
    if (candidate.assignee) {
      formatted = `[${candidate.assignee}] `
    }

    // Add task
    formatted += candidate.task

    // Add deadline suffix
    if (candidate.deadline) {
      formatted += ` — Due: ${candidate.deadline}`
    }

    return formatted
  }

  /**
   * Batch validate multiple candidates
   */
  async validateBatch(
    candidates: ActionItemCandidate[],
    subject?: SubjectContext | null,
    useLLM: boolean = false
  ): Promise<Map<number, ValidationResult>> {
    const results = new Map<number, ValidationResult>()

    // Process in parallel for efficiency
    const validationPromises = candidates.map((candidate, index) =>
      this.validate(candidate, subject, useLLM).then(result => ({ index, result }))
    )

    const completed = await Promise.all(validationPromises)

    for (const { index, result } of completed) {
      results.set(index, result)
    }

    return results
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const actionItemValidationService = new ActionItemValidationService()

export default actionItemValidationService
