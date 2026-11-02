import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase/config';

export interface UploadResult {
  url: string;
  type: 'image' | 'video' | 'audio' | 'file';
  fileName: string;
  size: number;
}

const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_AUDIO_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Uploads a profile avatar or cover image to Firebase Storage and returns the permanent download URL.
 */
export async function uploadUserProfileImage(
  uid: string,
  file: File,
  type: 'avatar' | 'cover',
  onProgress?: (progress: number) => void
): Promise<string> {
  if (!uid) {
    throw new Error('Authentication required for file upload.');
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Invalid file format. Please upload a valid image (JPEG, PNG, WEBP, GIF).');
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Image size exceeds 15MB limit. Please select a smaller file.');
  }

  const extension = file.name.split('.').pop() || 'jpg';
  const fileName = `${type}_${Date.now()}.${extension}`;
  const storagePath = `users/${uid}/${fileName}`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedBy: uid,
        type,
      },
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress?.(progress);
        }
      },
      (error) => {
        console.error('Firebase Storage upload error:', error);
        reject(new Error(error.message || 'Image upload failed. Please try again.'));
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          onProgress?.(100);
          resolve(downloadUrl);
        } catch (err: any) {
          reject(new Error('Failed to retrieve uploaded image URL: ' + (err.message || err)));
        }
      }
    );
  });
}

/**
 * Uploads a post media file (image or video) to Firebase Storage and returns permanent download URL and type.
 */
export async function uploadPostMedia(
  uid: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ url: string; type: 'image' | 'video' }> {
  if (!uid) {
    throw new Error('Authentication required for media upload.');
  }

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');

  if (!isImage && !isVideo) {
    throw new Error('Please upload an image or video file.');
  }

  if (isImage && file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Image size exceeds 15MB limit.');
  }

  if (isVideo && file.size > MAX_VIDEO_SIZE_BYTES) {
    throw new Error('Video size exceeds 50MB limit.');
  }

  const mediaType: 'image' | 'video' = isVideo ? 'video' : 'image';
  const cleanName = sanitizeFileName(file.name);
  const storagePath = `posts/${uid}/${Date.now()}_${cleanName}`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        uploadedBy: uid,
        mediaType,
      },
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress?.(progress);
        }
      },
      (error) => {
        console.error('Post media upload error:', error);
        reject(new Error(error.message || 'Media upload failed. Please check network and retry.'));
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          onProgress?.(100);
          resolve({ url: downloadUrl, type: mediaType });
        } catch (err: any) {
          reject(new Error('Failed to retrieve uploaded media URL.'));
        }
      }
    );
  });
}

/**
 * Uploads a chat attachment (image, video, voice note or file) to Firebase Storage.
 */
export async function uploadChatAttachment(
  uid: string,
  file: File | Blob,
  fileName?: string,
  onProgress?: (progress: number) => void
): Promise<{ url: string; type: 'image' | 'video' | 'audio' | 'file' }> {
  if (!uid) {
    throw new Error('Authentication required for message attachments.');
  }

  let type: 'image' | 'video' | 'audio' | 'file' = 'file';
  if (file.type.startsWith('image/')) type = 'image';
  else if (file.type.startsWith('video/')) type = 'video';
  else if (file.type.startsWith('audio/')) type = 'audio';

  const cleanName = sanitizeFileName(fileName || (file instanceof File ? file.name : `voice_${Date.now()}.webm`));
  const storagePath = `chats/${uid}/${Date.now()}_${cleanName}`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress?.(progress);
        }
      },
      (error) => {
        console.error('Chat attachment upload error:', error);
        reject(new Error(error.message || 'Attachment upload failed.'));
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          onProgress?.(100);
          resolve({ url: downloadUrl, type });
        } catch (err: any) {
          reject(new Error('Failed to retrieve attachment URL.'));
        }
      }
    );
  });
}
