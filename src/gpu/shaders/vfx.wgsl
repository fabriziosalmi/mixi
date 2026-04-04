// ─────────────────────────────────────────────────────────────
// Mixi – VFX Fragment Shader (WebGPU / WGSL)
//
// VJ Hardware Hacker Edition — Tier 1 Secrets Applied:
//   #1  FFT as texture_2d (HW interpolation between bins)
//   #4  Isolated stems: u_kick, u_snare, u_hihat
//   #5  BPM phase sync (0→1 sawtooth)
//   #6  Derivative trigger (dEnergy/dt)
//   #15 Polar spectrum (circular FFT)
//   #17 Chromatic aberration (RGB split × kick)
//   #22 Dynamic film grain (noise × RMS)
//   #23 Rule of Black (silence → darkness)
//
// Single full-screen triangle → composited effects.
// ─────────────────────────────────────────────────────────────

struct Uniforms {
  resolution: vec2f,    // 0: canvas px
  time: f32,            // 2: monotonic seconds
  beat_energy: f32,     // 3: 0..1 decayed envelope
  kick: f32,            // 4: 20-80Hz RMS (isolated stem)
  snare: f32,           // 5: 1-3kHz RMS (isolated stem)
  hihat: f32,           // 6: 8-15kHz RMS (isolated stem)
  hue: f32,             // 7: rotating hue 0..360
  beat_count: f32,      // 8: integer beat counter
  beat_phase: f32,      // 9: 0→1 sawtooth synced to BPM
  energy_deriv: f32,    // 10: dEnergy/dt (rate of change)
  total_energy: f32,    // 11: overall energy for Rule of Black
  crossfader: f32,      // 12: 0=deck A, 0.5=center, 1=deck B
  _pad0: f32,           // 13-15: alignment padding
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var fft_tex: texture_2d<f32>;
@group(0) @binding(2) var fft_sampler: sampler;

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
  let m = l - c * 0.5;
  return rgb + vec3f(m);
}

// Sample FFT with hardware interpolation (Secret #1)
fn fft_sample(bin_norm: f32) -> f32 {
  return textureSampleLevel(fft_tex, fft_sampler, vec2f(bin_norm, 0.5), 0.0).r;
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
  let uv = in.uv;
  let px = in.pos.xy;
  let res = u.resolution;
  let aspect = res.x / res.y;
  let t = u.time;

  // Centered UV (-0.5..0.5, aspect-corrected)
  let cuv = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  let dist = length(cuv);

  // Semantic deck colors (Secret #24 prep — cyan vs orange)
  let deck_a_color = vec3f(0.0, 0.9, 1.0);  // cyan
  let deck_b_color = vec3f(1.0, 0.57, 0.0);  // orange
  let deck_mix = mix(deck_a_color, deck_b_color, u.crossfader);

  var color = vec3f(0.0);
  var alpha = 0.0;

  // ── 1. Radial Shockwave (Beat Flash) ──────────────────────
  // Secret #6: Use energy derivative for sharper triggers
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

  // ── 2. Spectrum Bars (bottom, using texture FFT) ──────────
  {
    let bar_region_h = 0.20;
    let bar_y = 1.0 - uv.y;

    if (bar_y < bar_region_h) {
      let bin_norm = uv.x;
      let bin_frac = fract(bin_norm * 128.0);

      if (bin_frac > 0.08 && bin_frac < 0.92) {
        // Secret #1: Hardware-interpolated FFT sample
        let val = fft_sample(bin_norm);
        let bar_h = val * bar_region_h;

        if (bar_y < bar_h) {
          var bar_color: vec3f;
          if (bin_norm < 0.15) {
            bar_color = vec3f(1.0, 0.2, 0.1);
          } else if (bin_norm < 0.5) {
            let t2 = (bin_norm - 0.15) / 0.35;
            bar_color = mix(vec3f(0.2, 1.0, 0.3), vec3f(0.0, 0.8, 1.0), t2);
          } else {
            bar_color = vec3f(0.3, 0.5, 1.0);
          }

          // Tint by active deck (Secret #24 prep)
          bar_color = mix(bar_color, deck_mix, 0.2);

          let intensity = 1.0 - (bar_y / bar_h) * 0.5;
          color += bar_color * intensity * 0.5;
          alpha += intensity * 0.35;
        }
      }
    }
  }

  // ── 3. Polar Spectrum (Secret #15) ────────────────────────
  // Circular FFT ring — perfect behind jog wheels
  {
    let polar_r_min = 0.18;
    let polar_r_max = 0.28;

    if (dist > polar_r_min && dist < polar_r_max) {
      let angle = atan2(cuv.y, cuv.x); // -PI..PI
      let bin_norm = (angle + 3.14159) / 6.28318; // 0..1

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

  // ── 4. Procedural Particles (kick-driven) ─────────────────
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
        // Secret #4: kick drives particle speed
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
          // Particles use deck color
          let p_color = mix(deck_a_color, deck_b_color, hash11(seed * 8.9));
          color += p_color * brightness * 0.8;
          alpha += brightness * 0.4;
        }
      }
    }
  }

  // ── 5. Audio-Reactive Plasma ──────────────────────────────
  {
    // Secret #4: use isolated stems for different plasma layers
    let energy = u.kick * 0.6 + u.snare * 0.3 + u.hihat * 0.1;
    // Secret #5: BPM phase for synchronized pulsation
    let phase_pulse = sin(u.beat_phase * 6.2832) * 0.5 + 0.5;
    let plasma_speed = t * 0.3 + energy * 2.0;

    let p1 = sin(cuv.x * 4.0 + plasma_speed) * cos(cuv.y * 3.0 - plasma_speed * 0.7);
    let p2 = sin(cuv.y * 5.0 + plasma_speed * 1.3) * cos(cuv.x * 2.0 + plasma_speed);
    let p3 = sin(length(cuv * 6.0) - plasma_speed * 0.5);
    let plasma = (p1 + p2 + p3) / 3.0;

    let plasma_color = hsl2rgb(
      (u.hue + plasma * 40.0 + 180.0) % 360.0,
      0.6,
      0.4 + plasma * 0.15,
    );

    let plasma_intensity = (0.03 + energy * 0.05) * (0.7 + phase_pulse * 0.3);
    color += plasma_color * plasma_intensity;
    alpha += plasma_intensity * 0.5;
  }

  // ── 6. Scanlines ──────────────────────────────────────────
  {
    let scanline = step(0.33, fract(px.y / 3.0));
    color *= 1.0 - scanline * 0.04;
  }

  // ── 7. Vignette ───────────────────────────────────────────
  {
    let vig = smoothstep(0.25, 0.75, dist);
    color *= 1.0 - vig * 0.4;
  }

  // ── 8. Chromatic Aberration (Secret #17) ──────────────────
  // RGB split driven by kick energy — stronger at screen edges
  {
    let ca_strength = u.kick * 0.008 * dist; // stronger at edges
    if (ca_strength > 0.0005) {
      let dir = normalize(uv - vec2f(0.5));
      let r_offset = fft_sample(clamp(uv.x + dir.x * ca_strength, 0.0, 1.0));
      let b_offset = fft_sample(clamp(uv.x - dir.x * ca_strength, 0.0, 1.0));
      // Tint RGB channels based on shifted FFT reads
      color.r += r_offset * ca_strength * 15.0;
      color.b += b_offset * ca_strength * 15.0;
      alpha += ca_strength * 5.0;
    }
  }

  // ── 9. Dynamic Film Grain (Secret #22) ────────────────────
  {
    let grain_seed = vec2f(px.x + t * 1000.0, px.y + t * 777.0);
    let grain = hash21(grain_seed) * 2.0 - 1.0; // -1..1
    let grain_amount = u.total_energy * 0.04;
    color += vec3f(grain * grain_amount);
  }

  // ── 10. Rule of Black (Secret #23) ────────────────────────
  // Silence → darkness. Light must be earned.
  {
    let black_gate = smoothstep(0.0, 0.12, u.total_energy);
    alpha *= black_gate;
    color *= black_gate;
  }

  // Premultiplied alpha for mix-blend-mode: screen
  return vec4f(color * alpha, alpha);
}
