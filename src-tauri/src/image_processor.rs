use image::{DynamicImage, GenericImageView, ImageFormat, Rgba, RgbaImage};
use imageproc::filter::gaussian_blur_f32;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use log::{info, error};

#[derive(Debug, Deserialize)]
pub struct PhotoSlot {
    pub id: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub rotation: Option<f32>,
    pub layer: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CompositeRequest {
    pub frame_base64: Option<String>,
    pub frame_width: u32,
    pub frame_height: u32,
    pub photos_base64: Vec<String>,
    pub photo_slots: Vec<PhotoSlot>,
    pub filter: String,
    pub event_hashtag: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CompositeResponse {
    pub final_base64: String,
}

// Extract base64 payload from data URL
fn extract_base64(data_url: &str) -> Result<&str, String> {
    if let Some(pos) = data_url.find("base64,") {
        Ok(&data_url[pos + 7..])
    } else {
        Ok(data_url) // Assume it's already raw base64
    }
}

// Decode base64 to DynamicImage
fn decode_image(b64: &str) -> Result<DynamicImage, String> {
    let raw = extract_base64(b64)?;
    let bytes = general_purpose::STANDARD.decode(raw).map_err(|e| format!("Base64 decode error: {}", e))?;
    image::load_from_memory(&bytes).map_err(|e| format!("Image load error: {}", e))
}

// Encode DynamicImage to base64 JPEG
fn encode_to_jpeg_base64(img: &DynamicImage, quality: u8) -> Result<String, String> {
    let mut cursor = Cursor::new(Vec::new());
    
    // In image 0.25, write_to with ImageFormat does not support quality directly.
    // Use JpegEncoder for quality control.
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
    encoder.encode_image(img).map_err(|e| format!("JPEG encode error: {}", e))?;
    
    let b64 = general_purpose::STANDARD.encode(cursor.into_inner());
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

// Apply photo filters
fn apply_filter(img: &mut DynamicImage, filter_name: &str) {
    if filter_name == "none" || filter_name == "normal" {
        return;
    }

    let mut rgba_img = img.to_rgba8();
    
    match filter_name {
        "bw" => {
            for pixel in rgba_img.pixels_mut() {
                let r = pixel[0] as f32;
                let g = pixel[1] as f32;
                let b = pixel[2] as f32;
                let gray = (r * 0.299 + g * 0.587 + b * 0.114) as u8;
                pixel[0] = gray;
                pixel[1] = gray;
                pixel[2] = gray;
            }
        },
        "vintage" => {
            for pixel in rgba_img.pixels_mut() {
                let r = pixel[0] as f32;
                let g = pixel[1] as f32;
                let b = pixel[2] as f32;
                
                let tr = (r * 0.393 + g * 0.769 + b * 0.189).min(255.0) as u8;
                let tg = (r * 0.349 + g * 0.686 + b * 0.168).min(255.0) as u8;
                let tb = (r * 0.272 + g * 0.534 + b * 0.131).min(255.0) as u8;
                
                pixel[0] = tr;
                pixel[1] = tg;
                pixel[2] = tb;
            }
        },
        "warm" => {
            for pixel in rgba_img.pixels_mut() {
                pixel[0] = (pixel[0] as f32 * 1.1).min(255.0) as u8;
                pixel[2] = (pixel[2] as f32 * 0.9) as u8;
            }
        },
        "cool" => {
            for pixel in rgba_img.pixels_mut() {
                pixel[0] = (pixel[0] as f32 * 0.9) as u8;
                pixel[2] = (pixel[2] as f32 * 1.1).min(255.0) as u8;
            }
        },
        "film" => {
            for pixel in rgba_img.pixels_mut() {
                let r = pixel[0] as f32;
                let g = pixel[1] as f32;
                let b = pixel[2] as f32;
                let gray = r * 0.299 + g * 0.587 + b * 0.114;
                
                pixel[0] = (r * 0.85 + gray * 0.15).min(255.0) as u8;
                pixel[1] = (g * 0.85 + gray * 0.15).min(255.0) as u8;
                pixel[2] = (b * 0.85 + gray * 0.15).min(255.0) as u8;
            }
        },
        "vivid" => {
            for pixel in rgba_img.pixels_mut() {
                let r = pixel[0] as f32;
                let g = pixel[1] as f32;
                let b = pixel[2] as f32;
                let avg = (r + g + b) / 3.0;
                
                pixel[0] = (r + (r - avg) * 0.5).min(255.0).max(0.0) as u8;
                pixel[1] = (g + (g - avg) * 0.5).min(255.0).max(0.0) as u8;
                pixel[2] = (b + (b - avg) * 0.5).min(255.0).max(0.0) as u8;
            }
        },
        _ => {}
    }
    
    *img = DynamicImage::ImageRgba8(rgba_img);
}

// Main compositing function
pub fn composite_images(req: CompositeRequest) -> Result<CompositeResponse, String> {
    info!("Starting image composite: {}x{} with {} slots", req.frame_width, req.frame_height, req.photo_slots.len());
    
    // Create base canvas
    let mut canvas = RgbaImage::from_pixel(req.frame_width, req.frame_height, Rgba([255, 255, 255, 255]));

    // Extract below/above layers
    let mut below_slots = Vec::new();
    let mut above_slots = Vec::new();
    
    for (i, slot) in req.photo_slots.iter().enumerate() {
        if i >= req.photos_base64.len() {
            continue; // Skip if we don't have a photo for this slot
        }
        
        let is_above = slot.layer.as_deref() == Some("above");
        if is_above {
            above_slots.push((i, slot));
        } else {
            below_slots.push((i, slot));
        }
    }

    // Process a slot
    let draw_slot = |canvas: &mut RgbaImage, photo_idx: usize, slot: &PhotoSlot| -> Result<(), String> {
        let b64 = &req.photos_base64[photo_idx];
        let mut photo_img = decode_image(b64)?;
        
        // Apply filter
        apply_filter(&mut photo_img, &req.filter);
        
        // Calculate dimensions
        let dest_x = (slot.x / 1000.0 * req.frame_width as f32).round() as i64;
        let dest_y = (slot.y / 1000.0 * req.frame_height as f32).round() as i64;
        let dest_w = (slot.width / 1000.0 * req.frame_width as f32).round() as u32;
        let dest_h = (slot.height / 1000.0 * req.frame_height as f32).round() as u32;
        
        // Crop/Resize strategy (center crop)
        let img_aspect = photo_img.width() as f32 / photo_img.height() as f32;
        let slot_aspect = dest_w as f32 / dest_h as f32;
        
        let cropped = if img_aspect > slot_aspect {
            // Image is wider than slot: crop horizontally
            let target_w = (photo_img.height() as f32 * slot_aspect).round() as u32;
            let offset_x = (photo_img.width() - target_w) / 2;
            photo_img.crop(offset_x, 0, target_w, photo_img.height())
        } else {
            // Image is taller than slot: crop vertically
            let target_h = (photo_img.width() as f32 / slot_aspect).round() as u32;
            let offset_y = (photo_img.height() - target_h) / 2;
            photo_img.crop(0, offset_y, photo_img.width(), target_h)
        };
        
        // Resize to exactly fit slot
        let mut final_photo = cropped.resize_exact(dest_w, dest_h, image::imageops::FilterType::Lanczos3);
        
        // Handle rotation if needed (simplified: only 90/180/270 for now due to rust image limitations without heavy matrix math)
        // For arbitrary rotation, we'd need more complex image processing or leave it to simple cases
        if let Some(rot) = slot.rotation {
            if (rot - 90.0).abs() < 1.0 {
                final_photo = final_photo.rotate90();
            } else if (rot - 180.0).abs() < 1.0 {
                final_photo = final_photo.rotate180();
            } else if (rot - 270.0).abs() < 1.0 || (rot + 90.0).abs() < 1.0 {
                final_photo = final_photo.rotate270();
            }
            // Arbitrary rotation requires imageproc::geom::affine which is more complex to set up offsets for.
            // For most templates, it's 0 or 90.
        }
        
        // Draw onto canvas
        image::imageops::overlay(canvas, &final_photo.to_rgba8(), dest_x, dest_y);
        
        Ok(())
    };

    // Draw 'below' photos
    for (i, slot) in below_slots {
        if let Err(e) = draw_slot(&mut canvas, i, slot) {
            error!("Error drawing photo slot {}: {}", i, e);
        }
    }

    // Draw frame overlay
    if let Some(frame_b64) = &req.frame_base64 {
        match decode_image(frame_b64) {
            Ok(frame_img) => {
                let resized_frame = frame_img.resize_exact(req.frame_width, req.frame_height, image::imageops::FilterType::Lanczos3);
                image::imageops::overlay(&mut canvas, &resized_frame.to_rgba8(), 0, 0);
            },
            Err(e) => error!("Error loading frame image: {}", e)
        }
    }

    // Draw 'above' photos
    for (i, slot) in above_slots {
        if let Err(e) = draw_slot(&mut canvas, i, slot) {
            error!("Error drawing photo slot {}: {}", i, e);
        }
    }

    // Add event hashtag text if present
    if let Some(hashtag) = &req.event_hashtag {
        if !hashtag.is_empty() {
            // To render text we would use rusttype and imageproc::drawing::draw_text_mut
            // Due to font loading complexity during cold-start, we will log it for now
            // or we could bundle a font. For this iteration, we keep it simple.
            info!("Event hashtag provided: {}", hashtag);
        }
    }

    // Finalize
    let final_dyn_image = DynamicImage::ImageRgba8(canvas);
    let final_base64 = encode_to_jpeg_base64(&final_dyn_image, 95)?;

    info!("Composite successful");
    Ok(CompositeResponse { final_base64 })
}
