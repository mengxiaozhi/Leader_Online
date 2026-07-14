<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import AppIcon from '../components/AppIcon.vue'

const features = [
  {
    icon: 'shield',
    title: '專業固定',
    description: '依車型安排固定方式，降低運送途中的碰撞與位移。',
  },
  {
    icon: 'clock',
    title: '節點通知',
    description: '交車、運送、到站與取車狀態清楚掌握。',
  },
  {
    icon: 'calendar',
    title: '賽事協作',
    description: '配合活動時程與交車點，讓選手專心準備比賽。',
  },
]

const steps = [
  { number: '01', title: '線上選擇服務', description: '選擇適合的運送方案與日期。' },
  { number: '02', title: '指定交車點', description: '依時間與地點，將愛車安心交付。' },
  { number: '03', title: '專車運送', description: '專業固定與管理，直送賽事現場。' },
  { number: '04', title: '現場安心取車', description: '抵達後依流程取車，安心專注賽事。' },
]

const courseJourney = [
  { number: '01', title: '商店選課', description: '在原有商店瀏覽課程商品與開放團練場次，不必切換到其他平台。' },
  { number: '02', title: '計次票管理', description: '完成購買與款項確認後，課程計次票會直接放進會員皮夾。' },
  { number: '03', title: '預約開放場次', description: '依教練、時間與地點選擇場次，使用適用的課程票券完成預約。' },
  { number: '04', title: '到場核銷再扣堂', description: '預約不先扣堂，實際出席並由現場核銷後才扣除一次使用次數。' },
]

let revealObserver = null

onMounted(() => {
  const elements = Array.from(document.querySelectorAll('.brand-page [data-reveal]'))
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reduceMotion || !('IntersectionObserver' in window)) {
    elements.forEach(element => element.classList.add('is-visible'))
    return
  }

  revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      revealObserver?.unobserve(entry.target)
    })
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' })

  elements.forEach(element => revealObserver.observe(element))
})

onBeforeUnmount(() => {
  revealObserver?.disconnect()
})
</script>

<template>
  <main class="brand-page">
    <nav class="brand-mobile-header" aria-label="品牌導覽">
      <router-link to="/brand" aria-label="Leader Online 品牌首頁">
        <img src="/logo.png" alt="Leader Online" />
      </router-link>
      <router-link class="brand-mobile-header__cta" to="/store">前往商店</router-link>
    </nav>

    <section class="brand-hero" aria-labelledby="brand-hero-title">
      <div class="brand-hero__copy" data-reveal>
        <span class="brand-hero__rule" aria-hidden="true"></span>
        <h1 id="brand-hero-title">把每一台愛車，<br />安全送到起點。</h1>
        <p>Leader Online 專注自行車與鐵人賽事託運，從交車、運送到取車，全程清楚、準時、可追蹤。</p>
        <div class="brand-actions">
          <router-link class="brand-button brand-button--primary" to="/store?tab=events">
            立即預約託運
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </router-link>
          <router-link class="brand-button brand-button--outline" to="/brand#story">
            認識我們
          </router-link>
        </div>
        <p class="brand-hero__trust" aria-label="服務重點">專業固定 <span></span> 節點通知 <span></span> 賽事協作</p>
      </div>

      <figure class="brand-hero__media" data-reveal>
        <img
          src="/brand/hero-transport.jpg"
          alt="自行車選手與專業託運車在台灣海岸公路準備出發"
          fetchpriority="high"
          decoding="async"
        />
      </figure>
    </section>

    <section id="features" class="brand-assurance" aria-labelledby="assurance-title">
      <div class="brand-assurance__intro" data-reveal>
        <div class="brand-section-number" aria-hidden="true">1</div>
        <div>
          <h2 id="assurance-title">不只是運送，<br />是賽前安心的一部分。</h2>
          <p>從交車那一刻開始，我們用專業固定、清楚節點與賽事協作，照顧每一段路程。</p>
        </div>
      </div>

      <div class="brand-assurance__content">
        <div class="brand-features" data-reveal>
          <article v-for="feature in features" :key="feature.title" class="brand-feature">
            <AppIcon :name="feature.icon" class="brand-feature__icon" />
            <h3>{{ feature.title }}</h3>
            <p>{{ feature.description }}</p>
          </article>
        </div>
        <figure class="brand-assurance__media" data-reveal>
          <img
            src="/brand/bike-securement.jpg"
            alt="公路車與鐵人車在密閉式車廂內依間距專業固定"
            loading="lazy"
            decoding="async"
          />
        </figure>
      </div>
    </section>

    <section id="courses" class="brand-courses" aria-labelledby="courses-title">
      <div class="brand-courses__layout">
        <div class="brand-courses__intro" data-reveal>
          <div class="brand-section-number" aria-hidden="true">2</div>
          <div>
            <h2 id="courses-title">從訓練到出賽，<br />都在同一個平台完成。</h2>
            <p>Leader Online 把課程選購、團練預約、計次票與到場核銷整合進原有商店與皮夾，讓每一次訓練都清楚可管理。</p>
            <div class="brand-actions">
              <router-link class="brand-button brand-button--primary" to="/store?tab=courses">
                前往課程商店
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </router-link>
              <router-link class="brand-button brand-button--outline" to="/wallet?tab=courses">查看我的課程</router-link>
            </div>
          </div>
        </div>

        <ol class="brand-courses__rail" data-reveal>
          <li v-for="item in courseJourney" :key="item.number">
            <span class="brand-courses__number">{{ item.number }}</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
          </li>
        </ol>
      </div>
    </section>

    <section id="process" class="brand-process" aria-labelledby="process-title">
      <div class="brand-process__header" data-reveal>
        <h2 id="process-title">四個步驟，放心抵達。</h2>
        <router-link class="brand-text-link" to="/store?tab=events">
          查看服務檔期
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </router-link>
      </div>

      <ol class="brand-process__rail" data-reveal>
        <li v-for="step in steps" :key="step.number">
          <span class="brand-process__number">{{ step.number }}</span>
          <span class="brand-process__dot" aria-hidden="true"></span>
          <h3>{{ step.title }}</h3>
          <p>{{ step.description }}</p>
        </li>
      </ol>
    </section>

    <section id="story" class="brand-story" aria-labelledby="story-title">
      <figure class="brand-story__media" data-reveal>
        <img
          src="/brand/event-arrival.jpg"
          alt="選手在鐵人賽事現場從專業託運團隊手中取回自行車"
          loading="lazy"
          decoding="async"
        />
      </figure>
      <div class="brand-story__copy" data-reveal>
        <h2 id="story-title">每一次出發，都值得被好好接住。</h2>
        <span class="brand-story__rule" aria-hidden="true"></span>
        <p>我們知道，車不只是裝備。它承載訓練的累積、比賽的期待，也陪你走過每一段突破。Leader Online 把繁瑣的運送流程整理好，讓你把心力留給真正重要的賽道。</p>
        <router-link class="brand-text-link" to="/brand#features">
          了解 Leader Online
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </router-link>
      </div>
    </section>

    <section class="brand-cta" aria-labelledby="brand-cta-title" data-reveal>
      <div>
        <h2 id="brand-cta-title">下一場挑戰，從訓練到出發都準備好。</h2>
        <p>選擇課程、團練場次或託運服務，讓 Leader Online 幫你把準備流程整理清楚。</p>
      </div>
      <div class="brand-actions brand-actions--dark">
        <router-link class="brand-button brand-button--primary" to="/store">
          前往商店
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </router-link>
        <router-link class="brand-button brand-button--dark-outline" to="/brand#courses">查看課程服務</router-link>
      </div>
    </section>
  </main>
</template>

<style scoped>
.brand-page {
  --brand-red: #e30613;
  --brand-red-dark: #b90510;
  --brand-ink: #071426;
  --brand-navy: #031a32;
  --brand-muted: #4b5565;
  --brand-line: #d8dde5;
  --brand-soft: #f4f6f8;
  width: 100%;
  overflow: hidden;
  background: #fff;
  color: var(--brand-ink);
  font-family: var(--ui-font);
}

.brand-mobile-header {
  display: none;
}

.brand-hero {
  display: grid;
  min-height: calc(100svh - 65px);
  grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
  background: #fff;
}

.brand-hero__copy {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(4rem, 7vw, 8rem) clamp(2rem, 5vw, 6rem);
}

.brand-hero__rule {
  width: 4px;
  height: 92px;
  margin-bottom: clamp(2rem, 4vh, 3.25rem);
  background: var(--brand-red);
}

.brand-hero h1 {
  max-width: 760px;
  margin: 0;
  color: var(--brand-ink);
  font-size: clamp(2.9rem, 4.7vw, 5.6rem);
  font-weight: 760;
  letter-spacing: -0.055em;
  line-height: 1.08;
}

.brand-hero__copy > p:not(.brand-hero__trust) {
  max-width: 660px;
  margin: 2rem 0 0;
  color: #344054;
  font-size: clamp(1.05rem, 1.22vw, 1.35rem);
  line-height: 1.85;
}

.brand-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 2.25rem;
}

.brand-button {
  display: inline-flex;
  min-height: 54px;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 0.85rem 1.55rem;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.2;
  transition: transform 180ms ease, background-color 180ms ease, border-color 180ms ease;
}

.brand-button svg,
.brand-text-link svg {
  width: 1.2rem;
  height: 1.2rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.brand-button:hover {
  transform: translateY(-2px);
}

.brand-button:focus-visible,
.brand-text-link:focus-visible {
  outline: 3px solid rgba(227, 6, 19, 0.28);
  outline-offset: 4px;
}

.brand-button--primary {
  background: var(--brand-red);
  color: #fff;
}

.brand-button--primary:hover {
  background: var(--brand-red-dark);
}

.brand-button--outline {
  border-color: var(--brand-ink);
  background: #fff;
  color: var(--brand-ink);
}

.brand-button--outline:hover {
  border-color: var(--brand-red);
  color: var(--brand-red);
}

.brand-hero__trust {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin: 2.8rem 0 0;
  color: #344054;
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.brand-hero__trust span {
  width: 1px;
  height: 1rem;
  background: #b5bdc9;
}

.brand-hero__media {
  min-height: 620px;
  margin: 0;
  overflow: hidden;
  background: #dbe7ef;
}

.brand-hero__media img,
.brand-assurance__media img,
.brand-story__media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.brand-hero__media img {
  object-position: 62% center;
}

.brand-assurance {
  padding: clamp(5.5rem, 9vw, 10rem) clamp(1.5rem, 6vw, 7rem);
  background: #fff;
}

.brand-assurance__intro {
  display: grid;
  max-width: 1380px;
  grid-template-columns: auto minmax(0, 1fr);
  gap: clamp(1.5rem, 3.5vw, 4rem);
  margin: 0 auto 4rem;
}

.brand-section-number {
  color: var(--brand-red);
  font-family: var(--ui-display-font);
  font-size: clamp(5rem, 9vw, 9rem);
  font-weight: 760;
  letter-spacing: -0.08em;
  line-height: 0.78;
}

.brand-assurance h2,
.brand-courses h2,
.brand-process h2,
.brand-story h2,
.brand-cta h2 {
  margin: 0;
  color: var(--brand-ink);
  font-size: clamp(2.2rem, 3.7vw, 4.4rem);
  font-weight: 750;
  letter-spacing: -0.045em;
  line-height: 1.15;
}

.brand-assurance__intro p {
  max-width: 750px;
  margin: 1.6rem 0 0;
  color: var(--brand-muted);
  font-size: clamp(1rem, 1.2vw, 1.22rem);
  line-height: 1.85;
}

.brand-assurance__content {
  display: grid;
  max-width: 1380px;
  grid-template-columns: minmax(0, 0.95fr) minmax(420px, 1.05fr);
  align-items: stretch;
  gap: clamp(2rem, 5vw, 5.5rem);
  margin: 0 auto;
}

.brand-features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-self: center;
}

.brand-feature {
  min-width: 0;
  padding: 1rem clamp(1rem, 2vw, 2rem);
  border-left: 1px solid var(--brand-line);
}

.brand-feature:first-child {
  padding-left: 0;
  border-left: 0;
}

.brand-feature__icon {
  width: 2.1rem;
  height: 2.1rem;
  color: var(--brand-red);
  stroke-width: 1.6;
}

.brand-feature h3,
.brand-process__rail h3 {
  margin: 1.5rem 0 0;
  color: var(--brand-ink);
  font-size: 1.18rem;
  font-weight: 720;
  line-height: 1.35;
}

.brand-feature p,
.brand-process__rail p {
  margin: 0.85rem 0 0;
  color: var(--brand-muted);
  font-size: 0.95rem;
  line-height: 1.75;
}

.brand-assurance__media,
.brand-story__media {
  margin: 0;
  overflow: hidden;
  background: var(--brand-soft);
}

.brand-assurance__media {
  aspect-ratio: 16 / 10;
}

.brand-process {
  padding: clamp(5.5rem, 8vw, 8rem) clamp(1.5rem, 6vw, 7rem);
  background: var(--brand-soft);
}

.brand-courses {
  border-top: 1px solid var(--brand-line);
  padding: clamp(5.5rem, 9vw, 9rem) clamp(1.5rem, 6vw, 7rem);
  background: #fff;
}

.brand-courses__layout {
  display: grid;
  max-width: 1380px;
  grid-template-columns: minmax(0, 0.92fr) minmax(480px, 1.08fr);
  gap: clamp(3rem, 7vw, 8rem);
  margin: 0 auto;
}

.brand-courses__intro {
  display: grid;
  align-content: start;
  grid-template-columns: auto minmax(0, 1fr);
  gap: clamp(1.5rem, 3.5vw, 4rem);
}

.brand-courses__intro p {
  max-width: 650px;
  margin: 1.6rem 0 0;
  color: var(--brand-muted);
  font-size: clamp(1rem, 1.15vw, 1.18rem);
  line-height: 1.85;
}

.brand-courses__rail {
  margin: 0;
  padding: 0;
  border-bottom: 1px solid var(--brand-line);
  list-style: none;
}

.brand-courses__rail li {
  display: grid;
  grid-template-columns: 3.6rem minmax(130px, 0.48fr) minmax(0, 1fr);
  align-items: baseline;
  gap: clamp(1rem, 2.5vw, 2.5rem);
  border-top: 1px solid var(--brand-line);
  padding: 1.65rem 0;
}

.brand-courses__number {
  color: var(--brand-red);
  font-family: var(--ui-display-font);
  font-size: 1.05rem;
  font-weight: 760;
  letter-spacing: 0.06em;
}

.brand-courses__rail h3 {
  margin: 0;
  color: var(--brand-ink);
  font-size: 1.08rem;
  font-weight: 730;
  line-height: 1.4;
}

.brand-courses__rail p {
  margin: 0;
  color: var(--brand-muted);
  font-size: 0.95rem;
  line-height: 1.75;
}

.brand-process__header {
  display: flex;
  max-width: 1380px;
  align-items: end;
  justify-content: space-between;
  gap: 2rem;
  margin: 0 auto 4.2rem;
}

.brand-process__header h2 {
  font-size: clamp(2.15rem, 3.1vw, 3.5rem);
}

.brand-text-link {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.6rem;
  border-bottom: 1px solid currentColor;
  padding: 0.25rem 0 0.45rem;
  color: var(--brand-ink);
  font-size: 1rem;
  font-weight: 700;
  transition: color 180ms ease;
}

.brand-text-link:hover {
  color: var(--brand-red);
}

.brand-process__rail {
  position: relative;
  display: grid;
  max-width: 1380px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.brand-process__rail::before {
  position: absolute;
  top: 6.35rem;
  right: 0;
  left: 0;
  height: 2px;
  background: var(--brand-red);
  content: '';
}

.brand-process__rail li {
  position: relative;
  padding-right: clamp(1rem, 3vw, 3rem);
}

.brand-process__number {
  display: block;
  color: var(--brand-red);
  font-family: var(--ui-display-font);
  font-size: clamp(3.9rem, 6vw, 6rem);
  font-weight: 720;
  letter-spacing: -0.075em;
  line-height: 1;
}

.brand-process__dot {
  position: relative;
  z-index: 1;
  display: block;
  width: 15px;
  height: 15px;
  margin-top: 0.72rem;
  border: 3px solid var(--brand-red);
  border-radius: 999px;
  background: var(--brand-soft);
}

.brand-process__rail h3 {
  margin-top: 1.7rem;
}

.brand-story {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  align-items: stretch;
  padding: clamp(5.5rem, 8vw, 8.5rem) clamp(1.5rem, 6vw, 7rem);
  gap: clamp(3rem, 6vw, 7rem);
  background: #fff;
}

.brand-story__media {
  min-height: 520px;
}

.brand-story__media img {
  object-position: 52% center;
}

.brand-story__copy {
  display: flex;
  max-width: 650px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
}

.brand-story__copy h2 {
  font-size: clamp(2.2rem, 3.25vw, 3.85rem);
}

.brand-story__rule {
  width: 150px;
  height: 2px;
  margin: 2.25rem 0;
  background: var(--brand-red);
}

.brand-story__copy p {
  margin: 0 0 2rem;
  color: #344054;
  font-size: clamp(1rem, 1.1vw, 1.18rem);
  line-height: 2;
}

.brand-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 3rem;
  padding: clamp(4.5rem, 7vw, 7rem) clamp(1.5rem, 7vw, 8rem);
  background: var(--brand-navy);
  color: #fff;
}

.brand-cta h2 {
  color: #fff;
  font-size: clamp(2.25rem, 3.6vw, 4.2rem);
}

.brand-cta p {
  max-width: 760px;
  margin: 1.4rem 0 0;
  color: #cbd5e1;
  font-size: 1.05rem;
  line-height: 1.8;
}

.brand-actions--dark {
  flex: 0 0 auto;
  margin-top: 0;
}

.brand-button--dark-outline {
  border-color: rgba(255, 255, 255, 0.72);
  color: #fff;
}

.brand-button--dark-outline:hover {
  border-color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

[data-reveal] {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 720ms ease, transform 720ms cubic-bezier(0.22, 1, 0.36, 1);
}

[data-reveal].is-visible {
  opacity: 1;
  transform: translateY(0);
}

@media (max-width: 1100px) {
  .brand-hero {
    grid-template-columns: 1fr 1fr;
  }

  .brand-assurance__content {
    grid-template-columns: 1fr;
  }

  .brand-courses__layout {
    grid-template-columns: 1fr;
  }

  .brand-features {
    order: 2;
  }

  .brand-assurance__media {
    order: 1;
  }

  .brand-story {
    gap: 3.5rem;
  }

  .brand-cta {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 767px) {
  .brand-page {
    padding-bottom: 0;
  }

  .brand-mobile-header {
    position: relative;
    z-index: 2;
    display: flex;
    min-height: 68px;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--brand-line);
    padding: 0.8rem 1rem;
    background: #fff;
  }

  .brand-mobile-header img {
    width: auto;
    height: 32px;
  }

  .brand-mobile-header__cta {
    border-radius: 6px;
    padding: 0.7rem 0.85rem;
    background: var(--brand-red);
    color: #fff;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .brand-hero {
    min-height: auto;
    grid-template-columns: 1fr;
  }

  .brand-hero__copy {
    padding: 3.5rem 1.25rem 3rem;
  }

  .brand-hero__rule {
    width: 3px;
    height: 54px;
    margin-bottom: 1.6rem;
  }

  .brand-hero h1 {
    font-size: clamp(2.65rem, 12vw, 4rem);
    letter-spacing: -0.06em;
  }

  .brand-hero__copy > p:not(.brand-hero__trust) {
    margin-top: 1.5rem;
    font-size: 1rem;
    line-height: 1.75;
  }

  .brand-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .brand-button {
    width: 100%;
  }

  .brand-hero__trust {
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 2rem;
    font-size: 0.82rem;
  }

  .brand-hero__media {
    min-height: 0;
    aspect-ratio: 4 / 5;
  }

  .brand-hero__media img {
    object-position: 61% center;
  }

  .brand-assurance,
  .brand-courses,
  .brand-process,
  .brand-story {
    padding: 5rem 1.25rem;
  }

  .brand-assurance__intro {
    grid-template-columns: 1fr;
    gap: 1.25rem;
    margin-bottom: 2.8rem;
  }

  .brand-courses__intro {
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }

  .brand-section-number {
    font-size: 5.5rem;
  }

  .brand-assurance h2,
  .brand-courses h2,
  .brand-process h2,
  .brand-story h2,
  .brand-cta h2 {
    font-size: clamp(2.15rem, 10vw, 3.1rem);
  }

  .brand-features {
    grid-template-columns: 1fr;
  }

  .brand-feature,
  .brand-feature:first-child {
    padding: 1.8rem 0;
    border-top: 1px solid var(--brand-line);
    border-left: 0;
  }

  .brand-feature:first-child {
    border-top: 0;
  }

  .brand-feature h3 {
    margin-top: 1rem;
  }

  .brand-courses__rail li {
    grid-template-columns: 2.5rem minmax(0, 1fr);
    gap: 0.75rem 1rem;
    padding: 1.5rem 0;
  }

  .brand-courses__rail p {
    grid-column: 2;
  }

  .brand-process__header {
    align-items: flex-start;
    flex-direction: column;
    margin-bottom: 3rem;
  }

  .brand-process__rail {
    grid-template-columns: 1fr;
    gap: 0;
    padding-left: 3rem;
  }

  .brand-process__rail::before {
    top: 0.6rem;
    bottom: 0.6rem;
    left: 0.42rem;
    width: 2px;
    height: auto;
  }

  .brand-process__rail li {
    padding: 0 0 3rem;
  }

  .brand-process__rail li:last-child {
    padding-bottom: 0;
  }

  .brand-process__number {
    font-size: 4.2rem;
  }

  .brand-process__dot {
    position: absolute;
    top: 0.1rem;
    left: -3rem;
    margin: 0;
  }

  .brand-process__rail h3 {
    margin-top: 0.6rem;
  }

  .brand-story {
    grid-template-columns: 1fr;
  }

  .brand-story__media {
    min-height: 0;
    aspect-ratio: 4 / 5;
  }

  .brand-story__media img {
    object-position: 48% center;
  }

  .brand-story__rule {
    margin: 1.8rem 0;
  }

  .brand-cta {
    padding: 4.5rem 1.25rem;
  }

  .brand-actions--dark {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-reveal] {
    opacity: 1;
    transform: none;
    transition: none;
  }

  .brand-button {
    transition: none;
  }
}
</style>
