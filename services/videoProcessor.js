const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs-extra");
const path = require("path");
const { s3Client, BUCKET_NAME } = require("../config/aws");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

class VideoProcessor {
  constructor() {
    this.tempDir = "/tmp/video-processing";
    this.ensureTempDir();
    ffmpeg.setFfmpegPath("/usr/bin/ffmpeg");
    ffmpeg.setFfprobePath("/usr/bin/ffprobe");
  }

  async ensureTempDir() {
    await fs.ensureDir(this.tempDir);
  }

  async downloadFromS3(s3Key) {
    const localPath = path.join(this.tempDir, `${Date.now()}-${path.basename(s3Key)}`);
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
    const response = await s3Client.send(command);
    const fileStream = fs.createWriteStream(localPath);
    
    return new Promise((resolve, reject) => {
      response.Body.pipe(fileStream);
      fileStream.on("finish", () => resolve(localPath));
      fileStream.on("error", reject);
    });
  }

  async prepareOutputDir(videoId) {
    const outputDir = path.join(this.tempDir, videoId);
    await fs.ensureDir(outputDir);
    return outputDir;
  }

  async convertQuality(inputPath, outputDir, quality) {
    return new Promise((resolve, reject) => {
      const qualityDir = path.join(outputDir, quality.name);
      fs.ensureDirSync(qualityDir);
      
      const command = ffmpeg(inputPath)
        .output(path.join(qualityDir, "playlist.m3u8"))
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
        ])
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  }

  async uploadToS3(localDir, s3Prefix) {
    const files = await fs.readdir(localDir, { withFileTypes: true });
    const uploadPromises = [];

    for (const file of files) {
      const localPath = path.join(localDir, file.name);
      if (file.isDirectory()) {
        // Recursively upload subdirectories
        const subPrefix = `${s3Prefix}/${file.name}`;
        uploadPromises.push(this.uploadToS3(localPath, subPrefix));
      } else if (file.name.endsWith(".m3u8") || file.name.endsWith(".ts")) {
        const s3Key = `${s3Prefix}/${file.name}`;
        const fileContent = await fs.readFile(localPath);
        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          Body: fileContent,
          ContentType: file.name.endsWith(".m3u8")
            ? "application/vnd.apple.mpegurl"
            : "video/mp2t",
        });
        uploadPromises.push(s3Client.send(command));
      }
    }
    await Promise.all(uploadPromises);
  }

  async generateMasterPlaylist(outputDir, s3Prefix, videoId) {
    const qualities = ["360p", "720p"];
    let masterContent = "#EXTM3U\n#EXT-X-VERSION:3\n";
  
    qualities.forEach((quality) => {
      const bandwidth = quality === "360p" ? "500000" : "2000000";
      const resolution = quality === "360p" ? "640x360" : "1280x720";
      masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n`;
      masterContent += `${quality}/playlist.m3u8\n`; // ✅ Relative path
    });

    const masterPath = path.join(outputDir, "master.m3u8");
    await fs.writeFile(masterPath, masterContent);

    const masterS3Key = `${s3Prefix}/master.m3u8`;
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: masterS3Key,
      Body: masterContent,
      ContentType: "application/vnd.apple.mpegurl"
    });

    await s3Client.send(command);
    return masterS3Key;
  }

  async cleanup(localVideoPath, outputDir) {
    try {
      if (await fs.pathExists(localVideoPath)) await fs.remove(localVideoPath);
      if (await fs.pathExists(outputDir)) await fs.remove(outputDir);
    } catch (error) {
      console.warn("Cleanup warning:", error.message);
    }
  }

  // Legacy method for backward compatibility
  async convertToHLS(inputPath, outputDir, videoId) {
    return new Promise((resolve, reject) => {
      const qualities = [
        { name: "360p", resolution: "640x360", bitrate: "500k" },
        { name: "720p", resolution: "1280x720", bitrate: "2000k" }
      ];

      let command = ffmpeg(inputPath);

      qualities.forEach((quality) => {
        const qualityDir = path.join(outputDir, quality.name);
        fs.ensureDirSync(qualityDir);
        
        command = command
          .output(path.join(qualityDir, "playlist.m3u8"))
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
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  }

  async convertVideoToHLS(s3Key, videoId) {
    let localVideoPath = null;
    let outputDir = null;

    try {
      outputDir = path.join(this.tempDir, videoId);
      await fs.ensureDir(outputDir);

      localVideoPath = await this.downloadFromS3(s3Key);
      await this.convertToHLS(localVideoPath, outputDir, videoId);

      const s3Prefix = `hls/${videoId}`;
      await this.uploadToS3(outputDir, s3Prefix);
      const masterS3Key = await this.generateMasterPlaylist(outputDir, s3Prefix, videoId);

      const streamingUrls = {
        master: `https://${BUCKET_NAME}.s3.amazonaws.com/${masterS3Key}`,
        qualities: {
          "360p": `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/360p/playlist.m3u8`,
          "720p": `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/720p/playlist.m3u8`
        }
      };

      return {
        success: true,
        videoId,
        masterPlaylist: masterS3Key,
        streamingUrls
      };

    } catch (error) {
      throw error;
    } finally {
      await this.cleanup(localVideoPath, outputDir);
    }
  }
}

module.exports = new VideoProcessor();
