//! Lightweight metadata parser — reads ID3v2 and Vorbis Comment tags
//! from raw audio bytes without decoding audio data.
//!
//! This is intentionally minimal: we only extract text tags
//! (title, artist, album, genre, BPM) from the header bytes.
//! No external codec dependencies — keeps the .wasm binary small.
//!
//! Supported formats:
//!   - ID3v2.3 / ID3v2.4 (MP3, AIFF)
//!   - Vorbis Comment in OGG container
//!   - Vorbis Comment in FLAC container
//!
//! For full codec support, use the JS `music-metadata` library
//! as fallback (which is what Mixi already does).

use wasm_bindgen::prelude::*;

/// Parsed metadata result, returned as a flat string with
/// fields separated by `\x00` (null byte):
///   title \0 artist \0 album \0 genre \0 bpm
///
/// BPM is empty string if not found.
#[wasm_bindgen]
pub fn parse_metadata(data: &[u8]) -> String {
    let mut title = String::new();
    let mut artist = String::new();
    let mut album = String::new();
    let mut genre = String::new();
    let mut bpm = String::new();

    // Try ID3v2 first (MP3 files)
    if data.len() > 10 && &data[0..3] == b"ID3" {
        parse_id3v2(data, &mut title, &mut artist, &mut album, &mut genre, &mut bpm);
    }
    // Try FLAC
    else if data.len() > 4 && &data[0..4] == b"fLaC" {
        parse_flac_vorbis(data, &mut title, &mut artist, &mut album, &mut genre, &mut bpm);
    }
    // Try OGG
    else if data.len() > 4 && &data[0..4] == b"OggS" {
        parse_ogg_vorbis(data, &mut title, &mut artist, &mut album, &mut genre, &mut bpm);
    }

    // Return null-separated fields
    format!("{}\0{}\0{}\0{}\0{}", title, artist, album, genre, bpm)
}

// ── ID3v2 Parser ───────────────────────────────────────────────

fn parse_id3v2(
    data: &[u8],
    title: &mut String,
    artist: &mut String,
    album: &mut String,
    genre: &mut String,
    bpm: &mut String,
) {
    if data.len() < 10 {
        return;
    }

    let version = data[3]; // 3 = ID3v2.3, 4 = ID3v2.4
    let _flags = data[5];

    // ID3v2 size is synchsafe integer (4 bytes, 7 bits each)
    let tag_size = synchsafe_to_u32(&data[6..10]) as usize;
    let end = (10 + tag_size).min(data.len());

    let mut pos = 10;

    while pos + 10 <= end {
        // Frame header: 4-byte ID, 4-byte size, 2-byte flags
        let frame_id = &data[pos..pos + 4];
        let frame_size = if version >= 4 {
            synchsafe_to_u32(&data[pos + 4..pos + 8]) as usize
        } else {
            u32::from_be_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]]) as usize
        };

        if frame_size == 0 || pos + 10 + frame_size > end {
            break;
        }

        let frame_data = &data[pos + 10..pos + 10 + frame_size];

        match frame_id {
            b"TIT2" => *title = decode_id3_text(frame_data),
            b"TPE1" => *artist = decode_id3_text(frame_data),
            b"TALB" => *album = decode_id3_text(frame_data),
            b"TCON" => *genre = decode_id3_text(frame_data),
            b"TBPM" => *bpm = decode_id3_text(frame_data),
            _ => {}
        }

        pos += 10 + frame_size;
    }
}

/// Decode an ID3v2 text frame.
/// First byte is encoding: 0=ISO-8859-1, 1=UTF-16LE/BE, 2=UTF-16BE, 3=UTF-8
fn decode_id3_text(data: &[u8]) -> String {
    if data.is_empty() {
        return String::new();
    }

    let encoding = data[0];
    let text_bytes = &data[1..];

    match encoding {
        0 => {
            // ISO-8859-1: each byte maps directly to Unicode codepoint
            text_bytes.iter()
                .take_while(|&&b| b != 0)
                .map(|&b| b as char)
                .collect()
        }
        1 => {
            // UTF-16 with BOM
            if text_bytes.len() < 2 {
                return String::new();
            }
            let is_le = text_bytes[0] == 0xFF && text_bytes[1] == 0xFE;
            let payload = &text_bytes[2..];
            decode_utf16(payload, is_le)
        }
        2 => {
            // UTF-16BE without BOM
            decode_utf16(text_bytes, false)
        }
        3 => {
            // UTF-8
            String::from_utf8_lossy(text_bytes)
                .trim_end_matches('\0')
                .to_string()
        }
        _ => String::new(),
    }
}

fn decode_utf16(data: &[u8], little_endian: bool) -> String {
    let mut chars = Vec::new();
    let mut i = 0;
    while i + 1 < data.len() {
        let code = if little_endian {
            u16::from_le_bytes([data[i], data[i + 1]])
        } else {
            u16::from_be_bytes([data[i], data[i + 1]])
        };
        if code == 0 {
            break;
        }
        chars.push(code);
        i += 2;
    }
    String::from_utf16_lossy(&chars)
}

/// Convert ID3v2 synchsafe integer to u32.
/// Each byte uses only 7 bits (bit 7 is always 0).
fn synchsafe_to_u32(bytes: &[u8]) -> u32 {
    ((bytes[0] as u32) << 21)
        | ((bytes[1] as u32) << 14)
        | ((bytes[2] as u32) << 7)
        | (bytes[3] as u32)
}

// ── FLAC Vorbis Comment Parser ─────────────────────────────────

fn parse_flac_vorbis(
    data: &[u8],
    title: &mut String,
    artist: &mut String,
    album: &mut String,
    genre: &mut String,
    bpm: &mut String,
) {
    // Skip "fLaC" magic (4 bytes)
    let mut pos = 4;

    // Iterate metadata blocks
    while pos + 4 <= data.len() {
        let header = data[pos];
        let is_last = (header & 0x80) != 0;
        let block_type = header & 0x7F;
        let block_size = u32::from_be_bytes([0, data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        pos += 4;

        if block_type == 4 && pos + block_size <= data.len() {
            // Vorbis Comment block
            let block = &data[pos..pos + block_size];
            parse_vorbis_comment(block, title, artist, album, genre, bpm);
            return;
        }

        pos += block_size;
        if is_last {
            break;
        }
    }
}

// ── OGG Vorbis Comment Parser ──────────────────────────────────

fn parse_ogg_vorbis(
    data: &[u8],
    title: &mut String,
    artist: &mut String,
    album: &mut String,
    genre: &mut String,
    bpm: &mut String,
) {
    // Scan for Vorbis comment header (type 3)
    // OGG pages contain segments; we scan for the "\x03vorbis" signature
    let signature = b"\x03vorbis";
    if let Some(offset) = find_bytes(data, signature) {
        let comment_start = offset + signature.len();
        if comment_start < data.len() {
            parse_vorbis_comment(&data[comment_start..], title, artist, album, genre, bpm);
        }
    }
}

/// Parse a Vorbis Comment block.
/// Format: vendor_length (LE u32), vendor_string, comment_count (LE u32),
///         then N comments each with length (LE u32) + "KEY=VALUE" string.
fn parse_vorbis_comment(
    data: &[u8],
    title: &mut String,
    artist: &mut String,
    album: &mut String,
    genre: &mut String,
    bpm: &mut String,
) {
    if data.len() < 8 {
        return;
    }

    // Vendor string
    let vendor_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let mut pos = 4 + vendor_len;

    if pos + 4 > data.len() {
        return;
    }

    // Comment count
    let count = u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
    pos += 4;

    for _ in 0..count {
        if pos + 4 > data.len() {
            break;
        }
        let comment_len = u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        pos += 4;

        if pos + comment_len > data.len() {
            break;
        }

        if let Ok(comment) = std::str::from_utf8(&data[pos..pos + comment_len]) {
            if let Some((key, value)) = comment.split_once('=') {
                match key.to_uppercase().as_str() {
                    "TITLE" => *title = value.to_string(),
                    "ARTIST" => *artist = value.to_string(),
                    "ALBUM" => *album = value.to_string(),
                    "GENRE" => *genre = value.to_string(),
                    "BPM" | "TBPM" => *bpm = value.to_string(),
                    _ => {}
                }
            }
        }

        pos += comment_len;
    }
}

/// Find a byte pattern in a slice.
fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_data() {
        let result = parse_metadata(&[]);
        assert_eq!(result, "\0\0\0\0"); // all empty
    }

    #[test]
    fn test_unknown_format() {
        let result = parse_metadata(&[0xFF, 0xFB, 0x90, 0x00]); // MP3 sync word, no ID3
        assert_eq!(result, "\0\0\0\0");
    }

    #[test]
    fn test_synchsafe() {
        // 0x00 0x00 0x02 0x01 = 0*2^21 + 0*2^14 + 2*2^7 + 1 = 257
        assert_eq!(synchsafe_to_u32(&[0x00, 0x00, 0x02, 0x01]), 257);
    }

    #[test]
    fn test_decode_id3_text_latin1() {
        // Encoding 0 (Latin-1) + "Hello"
        let data = [0x00, b'H', b'e', b'l', b'l', b'o'];
        assert_eq!(decode_id3_text(&data), "Hello");
    }

    #[test]
    fn test_decode_id3_text_utf8() {
        // Encoding 3 (UTF-8) + "Café"
        let mut data = vec![0x03];
        data.extend_from_slice("Café".as_bytes());
        assert_eq!(decode_id3_text(&data), "Café");
    }

    #[test]
    fn test_id3v2_parsing() {
        // Build a minimal ID3v2.3 tag with title and artist
        let mut tag = Vec::new();

        // Header: "ID3", version 3.0, no flags
        tag.extend_from_slice(b"ID3");
        tag.push(3); // version major
        tag.push(0); // version minor
        tag.push(0); // flags

        // We'll fill in size after building frames
        let size_pos = tag.len();
        tag.extend_from_slice(&[0, 0, 0, 0]); // placeholder

        // TIT2 frame: "Test Song"
        tag.extend_from_slice(b"TIT2");
        let title_bytes = b"\x03Test Song"; // UTF-8 encoding
        tag.extend_from_slice(&(title_bytes.len() as u32).to_be_bytes());
        tag.extend_from_slice(&[0, 0]); // flags
        tag.extend_from_slice(title_bytes);

        // TPE1 frame: "Test Artist"
        tag.extend_from_slice(b"TPE1");
        let artist_bytes = b"\x03Test Artist";
        tag.extend_from_slice(&(artist_bytes.len() as u32).to_be_bytes());
        tag.extend_from_slice(&[0, 0]);
        tag.extend_from_slice(artist_bytes);

        // TBPM frame: "128"
        tag.extend_from_slice(b"TBPM");
        let bpm_bytes = b"\x03128";
        tag.extend_from_slice(&(bpm_bytes.len() as u32).to_be_bytes());
        tag.extend_from_slice(&[0, 0]);
        tag.extend_from_slice(bpm_bytes);

        // Write tag size (synchsafe)
        let tag_size = tag.len() - 10;
        let synchsafe = [
            ((tag_size >> 21) & 0x7F) as u8,
            ((tag_size >> 14) & 0x7F) as u8,
            ((tag_size >> 7) & 0x7F) as u8,
            (tag_size & 0x7F) as u8,
        ];
        tag[size_pos..size_pos + 4].copy_from_slice(&synchsafe);

        let result = parse_metadata(&tag);
        let parts: Vec<&str> = result.split('\0').collect();
        assert_eq!(parts[0], "Test Song",   "title");
        assert_eq!(parts[1], "Test Artist", "artist");
        assert_eq!(parts[4], "128",         "bpm");
    }

    #[test]
    fn test_vorbis_comment_parsing() {
        // Build a Vorbis Comment block
        let mut block = Vec::new();

        // Vendor string
        let vendor = b"test-vendor";
        block.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        block.extend_from_slice(vendor);

        // Comments
        let comments = [
            "TITLE=Vorbis Track",
            "ARTIST=Vorbis Artist",
            "ALBUM=Vorbis Album",
            "GENRE=Techno",
            "BPM=140",
        ];
        block.extend_from_slice(&(comments.len() as u32).to_le_bytes());
        for comment in &comments {
            block.extend_from_slice(&(comment.len() as u32).to_le_bytes());
            block.extend_from_slice(comment.as_bytes());
        }

        let mut title = String::new();
        let mut artist = String::new();
        let mut album = String::new();
        let mut genre = String::new();
        let mut bpm = String::new();

        parse_vorbis_comment(&block, &mut title, &mut artist, &mut album, &mut genre, &mut bpm);

        assert_eq!(title, "Vorbis Track");
        assert_eq!(artist, "Vorbis Artist");
        assert_eq!(album, "Vorbis Album");
        assert_eq!(genre, "Techno");
        assert_eq!(bpm, "140");
    }

    #[test]
    fn test_flac_parsing() {
        // Build minimal FLAC with a Vorbis Comment metadata block
        let mut data = Vec::new();
        data.extend_from_slice(b"fLaC"); // magic

        // STREAMINFO block (type 0, required, 34 bytes of zeros)
        data.push(0x00); // not last, type 0
        data.extend_from_slice(&[0, 0, 34]); // size = 34
        data.extend_from_slice(&[0u8; 34]);

        // Vorbis Comment block (type 4, last)
        let mut vc_block = Vec::new();
        let vendor = b"test";
        vc_block.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        vc_block.extend_from_slice(vendor);
        vc_block.extend_from_slice(&1u32.to_le_bytes()); // 1 comment
        let comment = b"TITLE=FLAC Song";
        vc_block.extend_from_slice(&(comment.len() as u32).to_le_bytes());
        vc_block.extend_from_slice(comment);

        data.push(0x84); // last block, type 4
        let vc_size = vc_block.len();
        data.push(((vc_size >> 16) & 0xFF) as u8);
        data.push(((vc_size >> 8) & 0xFF) as u8);
        data.push((vc_size & 0xFF) as u8);
        data.extend_from_slice(&vc_block);

        let result = parse_metadata(&data);
        let parts: Vec<&str> = result.split('\0').collect();
        assert_eq!(parts[0], "FLAC Song");
    }
}
