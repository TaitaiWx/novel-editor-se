/** Real CDP pointer dispatch: actionability must survive hovering and asynchronous layout. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupAppSuite } from './support/suite';

const suite = setupAppSuite({ fixture: { prefix: 'novel-editor-e2e-pointer-' } });
const TARGET = '#pointer-fixture-target';

beforeEach(async () => {
  await suite.page.mouseMove(1, 1);
  await suite.page.evaluate(() => {
    const root = document.createElement('div');
    root.id = 'pointer-fixture';
    root.style.cssText = 'position:fixed;inset:50px 0 0;z-index:2147483647;background:white';
    root.innerHTML = `
      <button id="pointer-fixture-target" style="position:absolute;left:20px;top:20px;width:120px;height:40px">Target</button>
      <button id="pointer-fixture-neighbor" style="position:absolute;left:220px;top:20px;width:120px;height:40px">Neighbor</button>`;
    for (const button of root.querySelectorAll('button')) {
      button.dataset.clicks = '0';
      button.addEventListener('click', () => {
        button.dataset.clicks = String(Number(button.dataset.clicks) + 1);
      });
    }
    document.body.append(root);
  });
});

afterEach(async () => {
  await suite.page.evaluate(() => document.getElementById('pointer-fixture')?.remove());
});

async function clicks() {
  return suite.page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('#pointer-fixture button')).map(
      (button) => Number(button.dataset.clicks)
    )
  );
}

describe('CDP pointer driver', () => {
  it('rechecks the target after hover moves it and never clicks its neighbor', async () => {
    await suite.page.evaluate(() => {
      const target = document.getElementById('pointer-fixture-target')!;
      target.addEventListener(
        'pointerenter',
        () => {
          target.style.left = '220px';
          document.getElementById('pointer-fixture-neighbor')!.style.left = '20px';
        },
        { once: true }
      );
    });
    await suite.page.click(TARGET);
    expect(await clicks()).toEqual([1, 0]);
  });

  it('waits for a disabled control before dispatching its click', async () => {
    await suite.page.evaluate(() => {
      const target = document.getElementById('pointer-fixture-target') as HTMLButtonElement;
      target.disabled = true;
      setTimeout(() => {
        target.disabled = false;
      }, 200);
    });
    await suite.page.click(TARGET);
    expect(await clicks()).toEqual([1, 0]);
  });

  it('can hover a disabled control without requiring it to be clickable', async () => {
    await suite.page.evaluate(() => {
      (document.getElementById('pointer-fixture-target') as HTMLButtonElement).disabled = true;
    });
    await suite.page.hover(TARGET);
    expect(
      await suite.page.evaluate(() =>
        document.getElementById('pointer-fixture-target')!.matches(':hover')
      )
    ).toBe(true);
    expect(await clicks()).toEqual([0, 0]);
  });

  it('clicks a label through its text and toggles the associated control', async () => {
    await suite.page.evaluate(() => {
      const label = document.createElement('label');
      label.style.cssText = 'position:absolute;left:20px;top:100px';
      label.innerHTML =
        '<input type="checkbox" id="pointer-fixture-checkbox"><span style="pointer-events:none">Enable option</span>';
      document.getElementById('pointer-fixture')!.append(label);
    });
    await suite.page.click({ text: 'Enable option', exact: true });
    expect(
      await suite.page.evaluate(
        () => (document.getElementById('pointer-fixture-checkbox') as HTMLInputElement).checked
      )
    ).toBe(true);
  });

  it('does not fall back to clicking through a covering element', async () => {
    await suite.page.evaluate(() => {
      const cover = document.createElement('div');
      cover.id = 'pointer-fixture-cover';
      cover.style.cssText = 'position:absolute;inset:0;background:gray';
      cover.dataset.clicks = '0';
      cover.addEventListener('click', () => {
        cover.dataset.clicks = '1';
      });
      document.getElementById('pointer-fixture')!.append(cover);
      // Longer than the old 1.5s unchecked-location fallback, inside the normal action deadline.
      setTimeout(() => {
        cover.style.pointerEvents = 'none';
      }, 1800);
    });
    await suite.page.click(TARGET);
    expect(await clicks()).toEqual([1, 0]);
    expect(
      await suite.page.evaluate(
        () => document.getElementById('pointer-fixture-cover')!.dataset.clicks
      )
    ).toBe('0');
  });
});
