#!/bin/bash

# EC2 Deployment Script for Video Processing Service
# Run this script on your EC2 instance

echo "=== Deploying Video Processing Service on EC2 ==="

# Update system packages
echo "Updating system packages..."
sudo yum update -y

# Install Node.js using NVM
echo "Installing Node.js..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# Install FFmpeg
echo "Installing FFmpeg..."
sudo yum install -y ffmpeg ffmpeg-devel

# Verify FFmpeg installation
echo "Verifying FFmpeg installation..."
ffmpeg -version

# Install project dependencies
echo "Installing Node.js dependencies..."
npm install

# Create temp directory with proper permissions
echo "Setting up temp directory..."
sudo mkdir -p /tmp/video-processing
sudo chmod 755 /tmp/video-processing
sudo chown ec2-user:ec2-user /tmp/video-processing

# Create the video processor file
echo "Creating video processor file..."
cat > services/videoProcessor.js << 'EOF'
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { s3Client, BUCKET_NAME, generateSignedUrl } = require('../config/aws');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');

class VideoProcessor {
  constructor() {
    this.tempDir = '/tmp/video-processing';
    this.ensureTempDir();
    ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
    ffmpeg.setFfprobePath('/usr/bin/ffprobe');
  }

  async ensureTempDir() {
    await fs.ensureDir(this.tempDir);
  }

  async downloadFromS3(s3Key) {
    const localPath = path.join(this.tempDir, `${Date.now()}-${path.basename(s3Key)}`);
    
    try {
      console.log(`Downloading ${s3Key} to ${localPath}`);
      
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key
      });
      
      const response = await s3Client.send(command);
      const fileStream = fs.createWriteStream(localPath);
      
      return new Promise((resolve, reject) => {
        response.Body.pipe(fileStream);
        fileStream.on('finish', () => {
          console.log(`Download completed: ${localPath}`);
          resolve(localPath);
        });
        fileStream.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Failed to download video from S3: ${error.message}`);
    }
  }

  async uploadToS3(localDir, s3Prefix) {
    const files = await fs.readdir(localDir);
    const uploadPromises = [];

    console.log(`Uploading files from ${localDir} to S3 prefix: ${s3Prefix}`);

    for (const file of files) {
      if (file.endsWith('.m3u8') || file.endsWith('.ts')) {
        const localPath = path.join(localDir, file);
        const s3Key = `${s3Prefix}/${file}`;
        
        try {
          const fileContent = await fs.readFile(localPath);
          const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: fileContent,
            ContentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t'
          });
          
          uploadPromises.push(s3Client.send(command));
          console.log(`Queued upload: ${s3Key}`);
        } catch (error) {
          console.error(`Failed to read file ${localPath}:`, error);
        }
      }
    }

    await Promise.all(uploadPromises);
    console.log(`Uploaded ${uploadPromises.length} files to S3`);
  }

  async convertToHLS(inputPath, outputDir, videoId) {
    return new Promise((resolve, reject) => {
      console.log(`Starting HLS conversion for: ${inputPath}`);
      
      const qualities = [
        { name: '360p', resolution: '640x360', bitrate: '500k' },
        { name: '720p', resolution: '1280x720', bitrate: '2000k' }
      ];

      let command = ffmpeg(inputPath);

      qualities.forEach((quality, index) => {
        const qualityDir = path.join(outputDir, quality.name);
        fs.ensureDirSync(qualityDir);
        
        console.log(`Adding quality: ${quality.name} (${quality.resolution})`);
        
        command = command
          .output(path.join(qualityDir, 'playlist.m3u8'))
          .outputOptions([
            `-c:v libx264`,
            `-c:a aac`,
            `-b:v ${quality.bitrate}`,
            `-maxrate ${quality.bitrate}`,
            `-bufsize ${parseInt(quality.bitrate) * 2}k`,
            `-vf scale=${quality.resolution}`,
            `-hls_time 6`,
            `-hls_list_size 0`,
            `-hls_segment_filename ${qualityDir}/segment_%03d.ts`,
            `-f hls`
          ]);
      });

      command
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Processing: ${progress.percent}% done`);
        })
        .on('end', () => {
          console.log('HLS conversion completed successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('HLS conversion error:', err);
          reject(err);
        })
        .run();
    });
  }

  async generateMasterPlaylist(outputDir, s3Prefix, videoId) {
    console.log('Generating master playlist...');
    
    const qualities = ['360p', '720p'];
    let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

    qualities.forEach((quality) => {
      const bandwidth = quality === '360p' ? '500000' : '2000000';
      const resolution = quality === '360p' ? '640x360' : '1280x720';
      
      masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
      masterContent += `${s3Prefix}/${quality}/playlist.m3u8\n`;
    });

    const masterPath = path.join(outputDir, 'master.m3u8');
    await fs.writeFile(masterPath, masterContent);

    const masterS3Key = `${s3Prefix}/master.m3u8`;
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: masterS3Key,
      Body: masterContent,
      ContentType: 'application/vnd.apple.mpegurl'
    });

    await s3Client.send(command);
    console.log(`Master playlist uploaded: ${masterS3Key}`);
    return masterS3Key;
  }

  async cleanup(localVideoPath, outputDir) {
    try {
      if (await fs.pathExists(localVideoPath)) {
        await fs.remove(localVideoPath);
        console.log(`Cleaned up: ${localVideoPath}`);
      }
      if (await fs.pathExists(outputDir)) {
        await fs.remove(outputDir);
        console.log(`Cleaned up: ${outputDir}`);
      }
    } catch (error) {
      console.warn('Cleanup warning:', error.message);
    }
  }

  async convertVideoToHLS(s3Key, videoId) {
    let localVideoPath = null;
    let outputDir = null;

    try {
      console.log(`=== Starting HLS conversion for video: ${videoId} ===`);
      
      outputDir = path.join(this.tempDir, videoId);
      await fs.ensureDir(outputDir);

      console.log('Step 1: Downloading video from S3...');
      localVideoPath = await this.downloadFromS3(s3Key);

      console.log('Step 2: Converting to HLS...');
      await this.convertToHLS(localVideoPath, outputDir, videoId);

      console.log('Step 3: Uploading HLS files to S3...');
      const s3Prefix = `hls/${videoId}`;
      await this.uploadToS3(outputDir, s3Prefix);

      console.log('Step 4: Generating master playlist...');
      const masterS3Key = await this.generateMasterPlaylist(outputDir, s3Prefix, videoId);

      const streamingUrls = {
        master: `https://${BUCKET_NAME}.s3.amazonaws.com/${masterS3Key}`,
        qualities: {
          '360p': `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/360p/playlist.m3u8`,
          '720p': `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/720p/playlist.m3u8`
        }
      };

      console.log('=== HLS conversion completed successfully ===');
      return {
        success: true,
        videoId,
        masterPlaylist: masterS3Key,
        streamingUrls
      };

    } catch (error) {
      console.error('=== HLS conversion failed ===');
      console.error('Error:', error);
      throw error;
    } finally {
      await this.cleanup(localVideoPath, outputDir);
    }
  }
}

module.exports = new VideoProcessor();
EOF

echo "=== Deployment Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit .env file with your AWS credentials"
echo "2. Configure S3 bucket for public read access"
echo "3. Start the server: npm start"
echo "4. Test the API endpoints" 