/**
 * Debug script to test live notes LLM connectivity
 * Run this to diagnose why live notes are stuck in "Processing" state
 */

const { app } = require('electron');
const path = require('path');

// Set user data path to match the app
app.setPath('userData', path.join(require('os').homedir(), 'Library', 'Application Support', 'meeting-notes'));

app.whenReady().then(async () => {
  try {
    console.log('=== Live Notes Diagnostic ===\n');

    // Import services after app is ready
    const { settingsService } = require('./electron/services/settingsService');
    const { llmRoutingService } = require('./electron/services/llm/llmRoutingService');
    const { liveNoteGenerationService } = require('./electron/services/liveNoteGenerationService');

    // 1. Check auto-start setting
    console.log('1. Checking auto-start setting...');
    const autoStart = await settingsService.get('ai.autoStartLiveNotes');
    console.log(`   ai.autoStartLiveNotes = ${autoStart}`);

    // 2. Check LLM provider settings
    console.log('\n2. Checking LLM provider configuration...');
    const provider = await settingsService.get('ai.provider');
    const lmStudioUrl = await settingsService.get('ai.lmStudioUrl');
    console.log(`   ai.provider = ${provider}`);
    console.log(`   ai.lmStudioUrl = ${lmStudioUrl}`);

    // 3. Test LLM connectivity
    console.log('\n3. Testing LLM provider health...');
    const health = await llmRoutingService.checkHealth(true);
    console.log(`   Health check result:`, JSON.stringify(health, null, 2));

    if (!health.success) {
      console.error('   ❌ LLM provider is NOT available!');
      console.error('   Error:', health.error);
    } else {
      console.log('   ✅ LLM provider is available');
      console.log('   Model:', health.data?.loadedModel);
    }

    // 4. Check live notes service state
    console.log('\n4. Checking live notes service state...');
    const sessionState = liveNoteGenerationService.getSessionState();
    console.log(`   Session state:`, JSON.stringify(sessionState, null, 2));

    // 5. Test a simple LLM call
    if (health.success) {
      console.log('\n5. Testing simple LLM call...');
      const testStart = Date.now();
      const testResponse = await llmRoutingService.chatCompletion({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say "Hello" in one word.' }
        ],
        maxTokens: 10,
        temperature: 0.3
      });
      const testDuration = Date.now() - testStart;

      console.log(`   Response time: ${testDuration}ms`);
      console.log(`   Success: ${testResponse.success}`);
      if (testResponse.success) {
        console.log(`   Content:`, testResponse.data?.choices[0]?.message?.content);
      } else {
        console.error(`   Error:`, testResponse.error);
      }
    }

    console.log('\n=== Diagnostic Complete ===');
    console.log('\nRecommendations:');

    if (!autoStart) {
      console.log('⚠️  Auto-start is disabled. Enable it in recording controls.');
    }

    if (!health.success) {
      console.log('❌ LLM provider is not available. Solutions:');
      if (provider === 'local' || provider === 'lm-studio') {
        console.log('   - Start LM Studio and load a model');
        console.log('   - Ensure LM Studio is listening on', lmStudioUrl);
      } else if (provider === 'claude') {
        console.log('   - Ensure Claude CLI is installed: npm install -g @anthropic-ai/claude-cli');
        console.log('   - Check Claude CLI authentication');
      } else if (provider === 'cursor') {
        console.log('   - Ensure Cursor CLI is available');
      }
    }

    if (sessionState.isActive && sessionState.pendingSegments > 0) {
      console.log(`⚠️  Session is active with ${sessionState.pendingSegments} pending segments`);
      console.log('   These should process within 45 seconds of accumulation');
    }

    app.quit();
  } catch (error) {
    console.error('Error during diagnostic:', error);
    app.quit(1);
  }
});
