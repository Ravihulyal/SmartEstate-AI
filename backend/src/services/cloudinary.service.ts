import { randomUUID } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import type { UploadApiResponse } from "cloudinary";

const IMAGE_FOLDER = "smartestate/properties";

export class CloudinaryConfigurationError extends Error {
  constructor() {
    super("Cloudinary is not configured");
    this.name = "CloudinaryConfigurationError";
  }
}

export class InvalidImageContentError extends Error {
  constructor() {
    super("Image content does not match its declared type");
    this.name = "InvalidImageContentError";
  }
}

function configureCloudinary(): string {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new CloudinaryConfigurationError();
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true
  });

  return cloudName;
}

function hasExpectedSignature(file: Express.Multer.File): boolean {
  const bytes = file.buffer;

  if (file.mimetype === "image/jpeg") {
    return bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }

  if (file.mimetype === "image/png") {
    return bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (file.mimetype === "image/webp") {
    return bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  }

  return false;
}

function uploadBuffer(
  file: Express.Multer.File,
  sellerId: string
): Promise<UploadApiResponse> {
  const publicId = randomUUID();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: `${IMAGE_FOLDER}/${sellerId}`,
        public_id: publicId,
        overwrite: false,
        use_filename: false,
        unique_filename: false,
        allowed_formats: ["jpg", "jpeg", "png", "webp"]
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result) {
          reject(new Error("Cloudinary returned no upload result"));
          return;
        }

        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

export function getOwnedCloudinaryPublicId(
  imageUrl: string,
  sellerId: string
): string | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return null;

  try {
    const url = new URL(imageUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    if (segments[0] !== cloudName) return null;
    const uploadIndex = segments.indexOf("upload");
    if (uploadIndex < 0 || segments[uploadIndex + 1] === undefined) return null;

    const assetSegments = segments.slice(uploadIndex + 1);
    if (/^v\d+$/.test(assetSegments[0])) assetSegments.shift();

    const fileName = assetSegments[assetSegments.length - 1];
    if (!fileName || !/\.(jpe?g|png|webp)$/i.test(fileName)) return null;

    const folders = assetSegments.slice(0, -1);
    if (
      folders[0] !== "smartestate" ||
      folders[1] !== "properties" ||
      folders[2] !== sellerId ||
      folders.length !== 3
    ) {
      return null;
    }

    const publicId = assetSegments.join("/").replace(/\.(jpe?g|png|webp)$/i, "");
    return publicId || null;
  } catch {
    return null;
  }
}

export async function uploadPropertyImages(
  sellerId: string,
  files: Express.Multer.File[]
): Promise<string[]> {
  if (!files.every(hasExpectedSignature)) {
    throw new InvalidImageContentError();
  }

  configureCloudinary();
  const uploaded: UploadApiResponse[] = [];

  try {
    for (const file of files) {
      const result = await uploadBuffer(file, sellerId);
      if (
        !result.secure_url ||
        !getOwnedCloudinaryPublicId(result.secure_url, sellerId)
      ) {
        throw new Error("Cloudinary returned an unexpected asset URL");
      }
      uploaded.push(result);
    }

    return uploaded.map((image) => image.secure_url);
  } catch (error) {
    await Promise.all(
      uploaded.map(async (image) => {
        try {
          await cloudinary.uploader.destroy(image.public_id, {
            resource_type: "image",
            invalidate: true
          });
        } catch {
          console.error("Failed to clean up a partial Cloudinary upload");
        }
      })
    );

    if (error instanceof CloudinaryConfigurationError || error instanceof InvalidImageContentError) {
      throw error;
    }

    console.error("Cloudinary image upload failed");
    throw new Error("Cloudinary image upload failed");
  }
}

export async function deleteOwnedCloudinaryImage(
  imageUrl: string,
  sellerId: string
): Promise<void> {
  configureCloudinary();
  const publicId = getOwnedCloudinaryPublicId(imageUrl, sellerId);
  if (!publicId) {
    throw new InvalidImageContentError();
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true
    });

    if (result.result !== "ok" && result.result !== "not found") {
      throw new Error("Cloudinary did not delete the image");
    }
  } catch {
    console.error("Cloudinary image deletion failed");
    throw new Error("Cloudinary image deletion failed");
  }
}
