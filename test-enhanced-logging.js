const cloudWatchLogger = require('./services/cloudWatchLogger');
const backgroundProcessor = require('./services/backgroundProcessor');

async function testEnhancedLogging() {
  console.log('🧪 Testing Enhanced CloudWatch Logging...\n');

  const testVideoId = 'test-enhanced-' + Date.now();
  const testS3Key = 'videos/test-enhanced-video.mp4';

  try {
    console.log('1. Testing CloudWatch logger directly...');
    
    // Test all logging functions
    await cloudWatchLogger.logStart(testVideoId, testS3Key);
    await cloudWatchLogger.logDownload(testVideoId, 25);
    await cloudWatchLogger.logConversion(testVideoId, '360p', 50);
    await cloudWatchLogger.logUpload(testVideoId, 75);
    await cloudWatchLogger.logComplete(testVideoId, {
      master: 'https://example.com/master.m3u8',
      qualities: {
        '360p': 'https://example.com/360p.m3u8',
        '720p': 'https://example.com/720p.m3u8'
      }
    });

    console.log('✅ CloudWatch logging test completed');

    console.log('\n2. Testing background processor...');
    
    // Test starting a job (this will fail since we don't have real S3 file)
    try {
      const result = await backgroundProcessor.startEncodingJob(testVideoId, testS3Key);
      console.log('✅ Job started:', result);
    } catch (error) {
      console.log('⚠️ Expected error (no real S3 file):', error.message);
    }

    console.log('\n3. Testing error logging...');
    await cloudWatchLogger.logError(testVideoId, new Error('Test error for enhanced logging'));

    console.log('\n🎉 Enhanced logging test completed!');
    console.log('\n📝 What you should see:');
    console.log('   - Detailed console logs with emojis');
    console.log('   - CloudWatch logs with progress from 0% to 100%');
    console.log('   - Better error details in both console and CloudWatch');
    console.log('   - Step-by-step progress tracking');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testEnhancedLogging(); 