/**
 * LLM Post-Processing Integration Test
 * 
 * This script tests that the LLM post-processing service is properly
 * integrated into the diarization pipeline.
 */

import { llmPostProcessingService } from '../electron/services/llmPostProcessingService'
import { DiarizationOutput } from '../electron/services/diarizationOutputSchema'

async function testLLMIntegration() {
  console.log('='.repeat(80))
  console.log('LLM Post-Processing Integration Test')
  console.log('='.repeat(80))
  console.log()

  // Test 1: Check availability
  console.log('Test 1: Checking LM Studio availability...')
  const availability = await llmPostProcessingService.checkAvailability()
  console.log('  Result:', availability)
  console.log()

  if (!availability.available) {
    console.log('⚠️  LM Studio is not available. Make sure:')
    console.log('   1. LM Studio is running')
    console.log('   2. A model is loaded')
    console.log('   3. Server is started on port 1234')
    console.log()
    console.log('Skipping further tests...')
    return
  }

  console.log('✅ LM Studio is available!')
  console.log()

  // Test 2: Get current configuration
  console.log('Test 2: Getting current configuration...')
  const config = llmPostProcessingService.getConfig()
  console.log('  LM Studio Config:', config.lmStudio)
  console.log('  Thresholds:', config.thresholds)
  console.log()

  // Test 3: Process mock diarization output
  console.log('Test 3: Processing mock diarization output...')
  
  const mockDiarizationOutput: DiarizationOutput = {
    success: true,
    segments: [
      {
        speaker_id: 'SPEAKER_0',
        start_time: 0.0,
        end_time: 2.5,
        confidence: 0.85
      },
      {
        speaker_id: 'SPEAKER_1',
        start_time: 2.5,
        end_time: 5.0,
        confidence: 0.75
      },
      {
        speaker_id: 'SPEAKER_0',
        start_time: 5.0,
        end_time: 7.5,
        confidence: 0.50  // Low confidence - should be processed by LLM
      },
      {
        speaker_id: 'SPEAKER_1',
        start_time: 7.0,  // Overlaps with previous segment
        end_time: 9.0,
        confidence: 0.70
      }
    ],
    speaker_ids: ['SPEAKER_0', 'SPEAKER_1'],
    num_speakers: 2,
    audio_duration: 9.0,
    processing_time: 2.5,
    schema_version: '1.0.0'
  }

  console.log('  Mock output has:')
  console.log('    - 4 segments')
  console.log('    - 2 speakers')
  console.log('    - 1 low-confidence segment (0.50)')
  console.log('    - 1 overlap')
  console.log()

  const startTime = Date.now()
  const result = await llmPostProcessingService.processOutput(mockDiarizationOutput, {
    resolveOverlaps: true,
    resolveLowConfidence: true,
    generateDisplayOrder: true,
    generateSummary: false
  })
  const duration = Date.now() - startTime

  console.log('  Result:')
  console.log('    - Success:', result.success)
  console.log('    - Processing time:', duration, 'ms')
  console.log('    - Speaker mappings:', result.speakerMappings.length)
  console.log('    - Overlap resolutions:', result.overlapResolutions.length)
  console.log('    - Low-confidence resolutions:', result.lowConfidenceResolutions.length)
  console.log('    - LLM requests made:', result.metadata.llmRequestCount)
  console.log('    - Guardrail violations:', result.metadata.guardrailViolations.length)
  console.log()

  if (result.success) {
    console.log('✅ LLM post-processing succeeded!')
    
    // Show speaker mappings
    if (result.speakerMappings.length > 0) {
      console.log()
      console.log('  Speaker Mappings:')
      result.speakerMappings.forEach(mapping => {
        console.log(`    - ${mapping.sessionSpeakerId}:`)
        console.log(`      Duration: ${mapping.totalDuration.toFixed(2)}s`)
        console.log(`      Confidence: ${mapping.averageConfidence.toFixed(2)}`)
      })
    }

    // Show overlap resolutions
    if (result.overlapResolutions.length > 0) {
      console.log()
      console.log('  Overlap Resolutions:')
      result.overlapResolutions.forEach(resolution => {
        console.log(`    - Time: ${resolution.overlapTimeRange.start.toFixed(2)}s - ${resolution.overlapTimeRange.end.toFixed(2)}s`)
        console.log(`      Primary Speaker: ${resolution.recommendedPrimarySpeaker}`)
        console.log(`      Confidence: ${resolution.resolutionConfidence.toFixed(2)}`)
        console.log(`      Applied: ${resolution.applied}`)
      })
    }

    // Show low-confidence resolutions
    if (result.lowConfidenceResolutions.length > 0) {
      console.log()
      console.log('  Low-Confidence Resolutions:')
      result.lowConfidenceResolutions.forEach(resolution => {
        console.log(`    - Segment ${resolution.segmentIndex}:`)
        console.log(`      Original: ${resolution.originalSpeakerId} (${resolution.originalConfidence.toFixed(2)})`)
        console.log(`      Suggested: ${resolution.suggestedSpeakerId || 'Keep original'}`)
        console.log(`      Applied: ${resolution.applied}`)
        console.log(`      Reasoning: ${resolution.reasoning}`)
      })
    }

    // Show display order
    if (result.displayOrder) {
      console.log()
      console.log('  Display Order Recommendation:')
      console.log(`    Order: ${result.displayOrder.order.join(' → ')}`)
      console.log(`    Reasoning: ${result.displayOrder.reasoning}`)
    }
  } else {
    console.log('❌ LLM post-processing failed:', result.error)
  }

  console.log()
  console.log('='.repeat(80))
  console.log('Test complete!')
  console.log('='.repeat(80))
}

// Run the test
testLLMIntegration().catch(error => {
  console.error('Test failed with error:', error)
  process.exit(1)
})
