'use strict';

const cloudinary = require('cloudinary').v2;
const config = require('../config');

cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  secure: true,
});

/* ─── Cloudinary ─────────────────────────────────────────────────────── */
function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

class Uploads {
  /**
   * Upload any file buffer to Cloudinary.
   * resourceType: 'image' | 'raw' (raw for PDFs) | 'auto'
   * Returns { url, publicId, assetId, bytes, format }.
   */
  async uploadBuffer(buffer, { folder, publicId, resourceType = 'image', tags, transformation, format = 'pdf' } = {}) {
    
    if (buffer instanceof ArrayBuffer) {
      buffer = Buffer.from(buffer);
    } else if (ArrayBuffer.isView(buffer) && !Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('uploads.uploadBuffer: non-empty Buffer required');
    }
    
    const result = await uploadBuffer(buffer, {
      folder: folder || config.cloudinary.folder,
      public_id: publicId,
      resource_type: resourceType,
      format,
      tags,
      transformation,
      overwrite: false,
    });
    
    return {
      url: result.secure_url,
      publicId: result.public_id,
      assetId: result.asset_id,
      bytes: result.bytes,
      format: result.format,
      resourceType: result.resource_type,
    };

  }

  /** Convenience for listing photos. */
  async uploadImage(buffer, options = {}) {
    return this.uploadBuffer(buffer, {
      folder: options.folder || `${config.cloudinary.folder}/listings`,
      resourceType: 'image',
      ...options,
    });
  }

  /** Convenience for signed instruction PDFs. */
  async uploadPdf(buffer, options = {}) {
    return this.uploadBuffer(buffer, {
      folder: options.folder || `${config.cloudinary.folder}/pw/vas`,
      resourceType: 'raw',
      format: 'pdf',
      ...options,
    });
  }

  /**
   * Upload a Facebook-hosted photo (URL) or a public URL to a page.
   * Single-image publish flow.
   */
  async publishSinglePhoto({ imageUrl, caption, published = true, pageId, pageToken }) {
    const pid = pageId || config.facebook.pageId;
    const token = pageToken || config.facebook.pageAccessToken;
    const base = `https://graph.facebook.com/${config.facebook.graphVersion}`;

    const body = new URLSearchParams();
    body.set('url', imageUrl);
    body.set('caption', caption || '');
    body.set('published', String(published));
    body.set('access_token', token);

    const res = await fetch(`${base}/${pid}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`Facebook photo upload failed: ${json.error?.message || res.status}`);
    }
    return {
      photoId: json.id,
      postId: json.post_id || null,
      postUrl: json.post_id ? `https://www.facebook.com/${json.post_id}` : null,
    };
  }

  /**
   * Post a single image with caption to the page (published immediately).
   * → POST /{page-id}/photos with published=true
   */
  async postImageToFacebook({ imageUrl, caption }) {
    return this.publishSinglePhoto({ imageUrl, caption, published: true });
  }

  /**
   * Post a text/link with up to 10 images.
   *  1. Upload each image as unpublished → get media_fbid
   *  2. POST /{page-id}/feed with message + link + attached_media
   * Returns the feed post id and URL.
   */
  async postMultiImageToFacebook({ imageUrls, message, link }) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      throw new Error('postMultiImageToFacebook: imageUrls must be a non-empty array');
    }
    const pid = config.facebook.pageId;
    const token = config.facebook.pageAccessToken;
    const base = `https://graph.facebook.com/${config.facebook.graphVersion}`;

    /* Step 1 — upload each image as unpublished */
    const mediaFbids = [];
    for (const url of imageUrls) {
      const uploaded = await this.publishSinglePhoto({
        imageUrl: url,
        caption: '',
        published: false,
      });
      mediaFbids.push(uploaded.photoId);
    }

    /* Step 2 — publish feed post attaching the media */
    const body = new URLSearchParams();
    body.set('message', message || '');
    if (link) body.set('link', link);
    body.set('attached_media', JSON.stringify(mediaFbids.map((id) => ({ media_fbid: id }))));
    body.set('access_token', token);

    const res = await fetch(`${base}/${pid}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`Facebook feed post failed: ${json.error?.message || res.status}`);
    }
    return {
      postId: json.id,
      postUrl: `https://www.facebook.com/${json.id}`,
    };
  }

  /**
   * Unified entry point used by the listing service.
   * - 0 images → text/link post
   * - 1 image  → single photo post
   * - 2–10     → multi-image feed post
   */
  async publishListingToFacebook({ imageUrls = [], message, link }) {
    if (imageUrls.length === 0) {
      return this.postTextToFacebook({ message, link });
    }
    if (imageUrls.length === 1) {
      return this.postImageToFacebook({ imageUrl: imageUrls[0], caption: message });
    }
    return this.postMultiImageToFacebook({ imageUrls, message, link });
  }

  /** Text/link only. */
  async postTextToFacebook({ message, link }) {
    const pid = config.facebook.pageId;
    const token = config.facebook.pageAccessToken;
    const base = `https://graph.facebook.com/${config.facebook.graphVersion}`;

    const body = new URLSearchParams();
    body.set('message', message || '');
    if (link) body.set('link', link);
    body.set('access_token', token);

    const res = await fetch(`${base}/${pid}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`Facebook text post failed: ${json.error?.message || res.status}`);
    }
    return {
      postId: json.id,
      postUrl: `https://www.facebook.com/${json.id}`,
    };
  }

  /** Simple connectivity check — GET /{page-id}?fields=id,name. */
  async testFacebook() {
    const base = `https://graph.facebook.com/${config.facebook.graphVersion}`;
    const url = `${base}/${config.facebook.pageId}?fields=id,name&access_token=${encodeURIComponent(config.facebook.pageAccessToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`Facebook test failed: ${json.error?.message || res.status}`);
    }
    return { id: json.id, name: json.name };
  }

  /** Simple Cloudinary check — ping(). */
  async testCloudinary() {
    const result = await cloudinary.api.ping();
    return { status: result.status };
  }
}

module.exports = new Uploads();