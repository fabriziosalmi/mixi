<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const SPIN_SPEED = 200
const DECEL_MS   = 1400
const FADE_IN_MS = 900

const phase     = ref<'black'|'disc'|'stopping'|'ring'|'expand'|'flash'|'gone'>('black')
const angle     = ref(0)
const discOp    = ref(0)
const discCon   = ref(3)
const introOn   = ref(true)
const ringProg  = ref(0)     // 0→1 for glow sweep
const expScale  = ref(1)     // circle scale during expand

let raf = 0, lastT = 0, spd = SPIN_SPEED

function tick(now: number) {
  if (!lastT) lastT = now
  angle.value = (angle.value + spd * (now - lastT) / 1000) % 360
  lastT = now
  raf = requestAnimationFrame(tick)
}

/* ── Glow sweep: 360° in ~280ms ─────────────────────────── */
function runSweep(cb: () => void) {
  const dur = 280, t0 = performance.now()
  ;(function go(now: number) {
    const p = Math.min((now - t0) / dur, 1)
    ringProg.value = p
    if (p < 1) requestAnimationFrame(go); else cb()
  })(performance.now())
}

/* ── Circle expand to cover full viewport ────────────────── */
function runExpand(cb: () => void) {
  const dur = 320, maxS = 14, t0 = performance.now()
  ;(function go(now: number) {
    const p = Math.min((now - t0) / dur, 1)
    expScale.value = 1 + (maxS - 1) * p
    if (p < 1) requestAnimationFrame(go); else cb()
  })(performance.now())
}

/* ── Master timeline ────────────────────────────────────── */
onMounted(() => {
  raf = requestAnimationFrame(tick)

  // 150ms: fade disc in from black
  setTimeout(() => {
    phase.value = 'disc'
    const t0 = performance.now()
    ;(function fadeIn(now: number) {
      const p = Math.min((now - t0) / FADE_IN_MS, 1)
      discOp.value = p
      discCon.value = 3 - 1.95 * p
      if (p < 1) requestAnimationFrame(fadeIn)
    })(performance.now())
  }, 150)

  // 1300ms: decel → stop → white circle → glow sweep → expand → flash → gone
  setTimeout(() => {
    phase.value = 'stopping'
    const t0 = performance.now()
    ;(function decel(now: number) {
      const p = Math.min((now - t0) / DECEL_MS, 1)
      spd = SPIN_SPEED * Math.max(0, 1 - Math.pow(p, 0.35))
      if (p >= 1) {
        spd = 0
        angle.value -= 0.5
        // Disc → white circle
        phase.value = 'ring'
        runSweep(() => {
          // Expand circle to fill screen
          phase.value = 'expand'
          runExpand(() => {
            // Flash white, then vanish
            phase.value = 'flash'
            setTimeout(() => {
              phase.value = 'gone'
              setTimeout(() => { introOn.value = false }, 400)
            }, 120)
          })
        })
      } else requestAnimationFrame(decel)
    })(performance.now())
  }, 1300)
})

onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <Transition name="ifade">
    <div v-if="introOn" class="mi" :class="'p-'+phase">
      <!-- Black backdrop -->
      <div class="mi-bg"/>
      <!-- Full-screen white (after expand fills viewport) -->
      <div class="mi-white"/>

      <!-- Disc / Circle / Expand container -->
      <div class="mi-disc-area"
        :style="(phase==='expand'||phase==='flash') ? {transform:`scale(${expScale})`} : undefined">
        <!-- Vinyl (black/disc/stopping) -->
        <img v-if="phase==='black'||phase==='disc'||phase==='stopping'"
          src="/vinyl.webp" alt="MIXI vinyl record" class="mi-disc"
          :style="{
            transform: `rotate(${angle}deg)`,
            opacity: discOp,
            filter: `contrast(${discCon}) brightness(${discCon>1.5?0.85:1})`
          }"/>
        <!-- White circle (replaces disc instantly) -->
        <div v-if="phase==='ring'||phase==='expand'||phase==='flash'" class="mi-circle"/>
        <!-- Rotating glow sweep -->
        <svg v-if="phase==='ring'" class="mi-sweep" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48" fill="none"
            stroke="#fff" stroke-width="2.5"
            stroke-dasharray="302"
            :stroke-dashoffset="302 - ringProg * 302"
            stroke-linecap="round"/>
        </svg>
        <div class="mi-halo" :style="{opacity:discOp*0.25}"/>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mi{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none}

.mi-bg{position:absolute;inset:0;background:#000;transition:opacity .15s ease-out}
.p-flash .mi-bg,.p-gone .mi-bg{opacity:0}

.mi-white{position:absolute;inset:0;background:#fff;opacity:0;transition:opacity .08s ease}
.p-flash .mi-white{opacity:1}
.p-gone .mi-white{opacity:0;transition:opacity .35s ease-out}

.mi-disc-area{position:relative;width:min(300px,45vw);height:min(300px,45vw);will-change:transform}
.mi-disc{width:100%;height:100%;object-fit:contain;will-change:transform,filter,opacity}
.mi-halo{position:absolute;inset:-20%;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.07) 0%,transparent 70%);pointer-events:none}

/* White circle — same size as disc, instant pop */
.mi-circle{position:absolute;inset:0;border-radius:50%;background:#fff;box-shadow:0 0 30px rgba(255,255,255,0.6),0 0 60px rgba(255,255,255,0.25);animation:circPop .12s ease-out both}
@keyframes circPop{from{opacity:0;transform:scale(.93)}to{opacity:1;transform:scale(1)}}

/* Glow sweep SVG — brighter, with drop-shadow glow */
.mi-sweep{position:absolute;inset:-5%;width:110%;height:110%;filter:drop-shadow(0 0 8px rgba(255,255,255,0.9)) drop-shadow(0 0 16px rgba(255,255,255,0.4))}

/* Hide disc-area after flash */
.p-gone .mi-disc-area{display:none}

.ifade-leave-active{transition:opacity .35s ease-out}
.ifade-leave-to{opacity:0}
</style>