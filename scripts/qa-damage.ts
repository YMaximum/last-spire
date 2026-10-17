/** Development-only visual coverage; no storage API calls or player data. */
import { createRun, dealDamage, spawnEnemy } from '../src/v3/engine';
import { defaultProfile } from '../src/storage';
import { defaultSettings } from '../src/v3/storage';
import { BattleRenderer } from '../src/v3/render';
import { DAMAGE_STYLES } from '../src/v3/damage-numbers';
import {
  enableDamageNumbers,
  readDamageNumbers,
  type DamageElement,
} from '../src/v3/damage-feedback';

const run = createRun(defaultProfile(), 'bastion', 0, 0, 415);
run.weapons = [];
const settings = defaultSettings();
const canvas = document.querySelector<HTMLCanvasElement>('#arena')!;
const renderer = new BattleRenderer(canvas);
const elements = Object.keys(DAMAGE_STYLES) as DamageElement[];
const targets = elements.map((element, i) => {
  const angle = -Math.PI / 2 + (i * Math.PI * 2) / elements.length;
  const enemy = spawnEnemy(
    run,
    'armored',
    500 + Math.cos(angle) * 265,
    400 + Math.sin(angle) * 235,
    0,
  );
  enemy.hp = enemy.maxHp = 1000000;
  enemy.armor = 0;
  const label = document.createElement('span');
  label.textContent = element[0].toUpperCase() + element.slice(1);
  label.style.color = DAMAGE_STYLES[element].color;
  document.querySelector('#legend')!.append(label);
  return enemy;
});
let frozen = false,
  last = 0,
  nextBurst = 0;
function burst() {
  targets.forEach((enemy, i) => {
    for (const critical of [false, true])
      dealDamage(run, enemy, {
        rootId: i + Math.floor(run.time * 100),
        weaponId: 'gallery',
        depth: 0,
        source: 'primary',
        element: elements[i],
        damage: (28 + i * 7) * (critical ? 1.7 : 1),
        critical,
      });
    if (elements[i] === 'fire' || elements[i] === 'poison')
      dealDamage(run, enemy, {
        rootId: i,
        weaponId: 'gallery',
        depth: 1,
        source: 'dot',
        element: elements[i],
        damage: 3.7,
      });
    if (elements[i] === 'physical')
      dealDamage(run, enemy, {
        rootId: i,
        weaponId: 'gallery',
        depth: 1,
        source: 'retaliation',
        element: elements[i],
        damage: 24,
      });
  });
}
document.querySelector<HTMLButtonElement>('#replay')!.onclick = () => {
  enableDamageNumbers(run, false);
  enableDamageNumbers(run, settings.damageNumbers);
  burst();
  nextBurst = run.time + 1.25;
};
document.querySelector<HTMLButtonElement>('#freeze')!.onclick = (event) => {
  frozen = !frozen;
  (event.currentTarget as HTMLButtonElement).textContent = frozen ? 'Resume' : 'Freeze';
};
document.querySelector<HTMLInputElement>('#numbers')!.onchange = (event) => {
  settings.damageNumbers = (event.currentTarget as HTMLInputElement).checked;
};
document.querySelector<HTMLInputElement>('#motion')!.onchange = (event) => {
  settings.reducedMotion = (event.currentTarget as HTMLInputElement).checked;
};
function frame(now: number) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  if (!frozen) run.time += dt;
  renderer.draw(run, settings);
  if (!frozen && run.time >= nextBurst) {
    burst();
    nextBurst = run.time + 1.25;
  }
  document.querySelector('#number-status')!.textContent =
    `Damage numbers: ${settings.damageNumbers ? 'on' : 'off'} · Reduced motion: ${settings.reducedMotion ? 'on' : 'off'} · ${readDamageNumbers(run).length} live labels · ${canvas.clientWidth}×${canvas.clientHeight} CSS px`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
