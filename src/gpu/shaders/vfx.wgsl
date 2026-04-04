// ─────────────────────────────────────────────────────────────
// Mixi – VFX Fragment Shader (WebGPU / WGSL)
//
// VJ Hardware Hacker Edition — Tier 1 + Tier 2 Secrets:
//   #1  FFT as texture_2d (HW interpolation)
//   #2  Ring texture spectrogram (64-frame history)
//   #3  Max-hold peak data in ring texture
//   #4  Isolated stems: kick, snare, hihat
//   #5  BPM phase sync (0→1 sawtooth)
//   #6  Derivative trigger (dEnergy/dt)
//   #14 Feedback loops (ping-pong prev_frame)
//   #15 Polar spectrum (circular FFT)
//   #17 Chromatic aberration (RGB split × kick)
//   #18 CRT phosphor emulation (barrel + scanlines + phosphor)
//   #22 Dynamic film grain (noise × RMS)
//   #23 Rule of Black (silence → darkness)
//   #24 Semantic color binding (CSS deck colors)
//   #25 Filter washout (HPF→white, LPF→dark)
//   #28 Beatgrid Tron floor (BPM-synced perspective grid)
// ─────────────────────────────────────────────────────────────

struct Uniforms {
  resolution: vec2f,        // 0-1: canvas px
  time: f32,                // 2: monotonic seconds
  beat_energy: f32,         // 3: 0..1 decayed envelope
  kick: f32,                // 4: 20-80Hz RMS
  snare: f32,               // 5: 1-3kHz RMS
  hihat: f32,               // 6: 8-15kHz RMS
  hue: f32,                 // 7: rotating hue 0..360
  beat_count: f32,          // 8: integer beat counter
  beat_phase: f32,          // 9: 0→1 BPM sawtooth
  energy_deriv: f32,        // 10: dEnergy/dt
  total_energy: f32,        // 11: overall energy
  crossfader: f32,          // 12: 0=A, 0.5=center, 1=B
  color_filter: f32,        // 13: -1(LPF)→+1(HPF) #25
  ring_write_pos: f32,      // 14: 0..63 current row #2
  feedback_amount: f32,     // 15: 0..1 feedback strength #14
  deck_a_color: vec4f,      // 16-19: CSS --clr-a RGB #24
  deck_b_color: vec4f,      // 20-23: CSS --clr-b RGB #24
  _pad: vec4f,              // 24-27: alignment to 128B
  _pad2: vec4f,             // 28-31: alignment to 128B
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var fft_tex: texture_2d<f32>;
@group(0) @binding(2) var fft_sampler: sampler;
@group(0) @binding(3) var ring_tex: texture_2d<f32>;
@group(0) @binding(4) var prev_frame: texture_2d<f32>;
@group(0) @binding(5) var prev_sampler: sampler;

// ── Helpers ──────────────────────────────────────────────────

fn hash11(p: f32) -> f32 {
  var n = fract(p * 443.8975);
  n = n * (n + 33.33);
  n = n * (n + n);
  return fract(n);
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(p * vec2f(443.8975, 397.2973));
  p3 = p3 + dot(p3, p3 + 19.19);
  return fract(p3.x * p3.y);
}

fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3f {
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let hp = h / 60.0;
  let x = c * (1.0 - abs(hp % 2.0 - 1.0));
  var rgb = vec3f(0.0);
  if (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else { rgb = vec3f(c, 0.0, x); }
  return rgb + vec3f(l - c * 0.5);
}

// Secret #1: HW-interpolated FFT sample
fn fft_sample(bin_norm: f32) -> f32 {
  return textureSampleLevel(fft_tex, fft_sampler, vec2f(bin_norm, 0.5), 0.0).r;
}

// Secret #2: Ring spectrogram sample (age: 0=current, 1=oldest)
fn ring_sample(freq: f32, age: f32) -> f32 {
  let row = ((u.ring_write_pos - age * 63.0) % 64.0 + 64.0) % 64.0;
  let v = (row + 0.5) / 64.0;
  return textureSampleLevel(ring_tex, fft_sampler, vec2f(freq, v), 0.0).r;
}

// ── Vertex Shader ────────────────────────────────────────────

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VsOut {
  let x = f32(i32(vi & 1u)) * 4.0 - 1.0;
  let y = f32(i32(vi >> 1u)) * 4.0 - 1.0;
  var out: VsOut;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv = vec2f((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return out;
}

// ── Fragment Shader ──────────────────────────────────────────

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  let res = u.resolution;
  let t = u.time;
  let aspect = res.x / res.y;

  // ── 0. CRT Barrel Distortion (#18) — warp UVs globally ────
  var uv = in.uv;
  let barrel_offset = uv - 0.5;
  let barrel_dist2 = dot(barrel_offset, barrel_offset);
  uv = uv + barrel_offset * barrel_dist2 * 0.12;

  let px = uv * res;
  let cuv = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  let dist = length(cuv);

  // Secret #24: Semantic deck colors from CSS vars
  let deck_a = u.deck_a_color.rgb;
  let deck_b = u.deck_b_color.rgb;
  let deck_mix = mix(deck_a, deck_b, u.crossfader);

  var color = vec3f(0.0);
  var alpha = 0.0;

  // ── 1. Radial Shockwave ───────────────────────────────────
  let flash_trigger = max(u.beat_energy, u.energy_deriv * 0.5);
  if (flash_trigger > 0.05) {
    let ring_r = (1.0 - u.beat_energy) * 0.8;
    let ring_w = 0.08 + u.beat_energy * 0.12;
    let ring_d = abs(dist - ring_r);
    let ring = smoothstep(ring_w, 0.0, ring_d) * u.beat_energy;
    let glow = exp(-dist * 3.0) * u.beat_energy * 0.4;
    let flash_color = hsl2rgb(u.hue, 1.0, 0.7);
    color += flash_color * (ring + glow);
    alpha += (ring + glow) * 0.5;
  }

  // ── 2. Spectrum Bars + Ring Trails (#2) ───────────────────
  {
    let bar_region_h = 0.20;
    let bar_y = 1.0 - uv.y;

    if (bar_y < bar_region_h) {
      let bin_norm = uv.x;
      let bin_frac = fract(bin_norm * 128.0);

      if (bin_frac > 0.08 && bin_frac < 0.92) {
        let val = fft_sample(bin_norm);
        // Ring trail: fade from recent history
        let trail = ring_sample(bin_norm, 0.3) * 0.3 + ring_sample(bin_norm, 0.6) * 0.15;
        let combined = max(val, trail);
        let bar_h = combined * bar_region_h;

        if (bar_y < bar_h) {
          var bar_color: vec3f;
          if (bin_norm < 0.15) { bar_color = vec3f(1.0, 0.2, 0.1); }
          else if (bin_norm < 0.5) {
            bar_color = mix(vec3f(0.2, 1.0, 0.3), vec3f(0.0, 0.8, 1.0), (bin_norm - 0.15) / 0.35);
          } else { bar_color = vec3f(0.3, 0.5, 1.0); }
          bar_color = mix(bar_color, deck_mix, 0.2);
          let intensity = 1.0 - (bar_y / bar_h) * 0.5;
          // Distinguish current vs trail
          let is_trail = step(val * bar_region_h, bar_y);
          let trail_dim = mix(1.0, 0.4, is_trail);
          color += bar_color * intensity * 0.5 * trail_dim;
          alpha += intensity * 0.35 * trail_dim;
        }
      }
    }
  }

  // ── 3. Polar Spectrum (#15) ───────────────────────────────
  {
    let polar_r_min = 0.18;
    let polar_r_max = 0.28;
    if (dist > polar_r_min && dist < polar_r_max) {
      let angle = atan2(cuv.y, cuv.x);
      let bin_norm = (angle + 3.14159) / 6.28318;
      let val = fft_sample(bin_norm);
      let ring_thick = val * (polar_r_max - polar_r_min);
      let ring_center = polar_r_min + ring_thick * 0.5;
      let ring_dist = abs(dist - ring_center);
      if (ring_dist < ring_thick * 0.5) {
        let intensity = (1.0 - ring_dist / (ring_thick * 0.5 + 0.001)) * 0.6;
        let polar_color = hsl2rgb((bin_norm * 360.0 + u.hue) % 360.0, 0.8, 0.5);
        color += polar_color * intensity;
        alpha += intensity * 0.4;
      }
    }
  }

  // ── 4. Tron Floor (#28) ───────────────────────────────────
  if (uv.y > 0.65) {
    let floor_y = (uv.y - 0.65) / 0.35;
    let pz = 1.0 / (floor_y + 0.01);
    let grid_x = fract(cuv.x * pz * 4.0);
    let grid_z = fract(pz * 2.0 + u.beat_phase);
    let line_x = smoothstep(0.02, 0.0, abs(grid_x - 0.5) - 0.48);
    let line_z = smoothstep(0.02, 0.0, abs(grid_z - 0.5) - 0.48);
    let grid = max(line_x, line_z);
    let fade = 1.0 - floor_y * 0.6;
    let tron_color = deck_mix * grid * fade;
    color += tron_color * 0.4;
    alpha += grid * 0.25 * fade;
  }

  // ── 5. Particles ──────────────────────────────────────────
  {
    let n_particles = 48u;
    let max_age = 2.0;
    for (var i = 0u; i < n_particles; i++) {
      let seed = f32(i) * 7.31 + u.beat_count * 1.17;
      let spawn_t = floor(seed) * 0.15;
      let age = t - spawn_t;
      let life = age / max_age;
      if (life > 0.0 && life < 1.0) {
        let angle = hash11(seed * 3.7) * 6.2832;
        let speed = 0.15 + hash11(seed * 5.1) * 0.35 + u.kick * 0.3;
        let spawn_offset = vec2f(
          (hash11(seed * 2.3) - 0.5) * 0.1,
          (hash11(seed * 4.1) - 0.5) * 0.1,
        );
        let pos = spawn_offset + vec2f(cos(angle), sin(angle)) * speed * life;
        let p_dist = length(cuv - pos);
        let radius = 0.004 + life * 0.002;
        if (p_dist < radius) {
          let brightness = (1.0 - life) * (1.0 - p_dist / radius);
          let p_color = mix(deck_a, deck_b, hash11(seed * 8.9));
          color += p_color * brightness * 0.8;
          alpha += brightness * 0.4;
        }
      }
    }
  }

  // ── 6. Plasma + Ring History (#2) ─────────────────────────
  {
    let energy = u.kick * 0.6 + u.snare * 0.3 + u.hihat * 0.1;
    // Ring history modulates plasma depth
    let history_energy = ring_sample(0.1, 0.5) * 0.3 + ring_sample(0.5, 0.8) * 0.2;
    let phase_pulse = sin(u.beat_phase * 6.2832) * 0.5 + 0.5;
    let ps = t * 0.3 + energy * 2.0;
    let p1 = sin(cuv.x * 4.0 + ps) * cos(cuv.y * 3.0 - ps * 0.7);
    let p2 = sin(cuv.y * 5.0 + ps * 1.3) * cos(cuv.x * 2.0 + ps);
    let p3 = sin(length(cuv * 6.0) - ps * 0.5);
    let plasma = (p1 + p2 + p3) / 3.0;
    let plasma_color = hsl2rgb((u.hue + plasma * 40.0 + 180.0) % 360.0, 0.6, 0.4 + plasma * 0.15);
    let plasma_intensity = (0.03 + energy * 0.05 + history_energy * 0.03) * (0.7 + phase_pulse * 0.3);
    color += plasma_color * plasma_intensity;
    alpha += plasma_intensity * 0.5;
  }

  // ── 7. Feedback Loop (#14) ────────────────────────────────
  if (u.feedback_amount > 0.01) {
    let fb_zoom = 1.0 + u.feedback_amount * 0.012;
    let fb_rot = u.hihat * 0.015 * u.feedback_amount;
    let fb_uv = uv - 0.5;
    let fb_cos = cos(fb_rot);
    let fb_sin = sin(fb_rot);
    let fb_rotated = vec2f(
      fb_uv.x * fb_cos - fb_uv.y * fb_sin,
      fb_uv.x * fb_sin + fb_uv.y * fb_cos,
    );
    let fb_coord = fb_rotated / fb_zoom + 0.5;
    let fb = textureSampleLevel(prev_frame, prev_sampler, fb_coord, 0.0);
    let fb_mix = 0.82 * u.feedback_amount;
    color = mix(color, fb.rgb, fb_mix);
    alpha = mix(alpha, fb.a, fb_mix * 0.9);
  }

  // ── 8. Filter Washout (#25) ───────────────────────────────
  if (u.color_filter > 0.02) {
    let hpf = u.color_filter;
    color = mix(color, vec3f(1.0), hpf * 0.3);
    color = (color - 0.5) * (1.0 + hpf * 0.5) + 0.5;
  } else if (u.color_filter < -0.02) {
    let lpf = -u.color_filter;
    let luma = dot(color, vec3f(0.299, 0.587, 0.114));
    color = mix(color, vec3f(luma), lpf * 0.5);
    color *= 1.0 - lpf * 0.4;
  }

  // ── 9. Chromatic Aberration (#17) ─────────────────────────
  {
    let ca_strength = u.kick * 0.008 * dist;
    if (ca_strength > 0.0005) {
      let dir = normalize(uv - vec2f(0.5));
      let r_val = fft_sample(clamp(uv.x + dir.x * ca_strength, 0.0, 1.0));
      let b_val = fft_sample(clamp(uv.x - dir.x * ca_strength, 0.0, 1.0));
      color.r += r_val * ca_strength * 15.0;
      color.b += b_val * ca_strength * 15.0;
      alpha += ca_strength * 5.0;
    }
  }

  // ── 10. CRT Phosphor + Scanlines (#18) ────────────────────
  {
    let px_mod = u32(px.x) % 3u;
    var phosphor = vec3f(0.7);
    if (px_mod == 0u) { phosphor.r = 1.0; }
    else if (px_mod == 1u) { phosphor.g = 1.0; }
    else { phosphor.b = 1.0; }
    color *= phosphor;

    let scan_y = uv.y * res.y;
    let scanline = 1.0 - smoothstep(0.3, 0.5, fract(scan_y / 2.0)) * 0.10;
    color *= scanline;
  }

  // ── 11. Film Grain (#22) ──────────────────────────────────
  {
    let grain_seed = vec2f(px.x + t * 1000.0, px.y + t * 777.0);
    let grain = hash21(grain_seed) * 2.0 - 1.0;
    color += vec3f(grain * u.total_energy * 0.04);
  }

  // ── 12. Vignette ──────────────────────────────────────────
  {
    let vig = smoothstep(0.25, 0.75, dist);
    color *= 1.0 - vig * 0.4;
  }

  // ── 13. Rule of Black (#23) — always last ─────────────────
  {
    let black_gate = smoothstep(0.0, 0.12, u.total_energy);
    alpha *= black_gate;
    color *= black_gate;
  }

  return vec4f(color * alpha, alpha);
}
