// src/features/pip.js
import { showToast } from '../ui.js';

export function initPiP() {
  const pipBtn = document.getElementById('pip-btn');
  const autoPipToggle = document.getElementById('auto-pip-toggle');
  const screenChat = document.getElementById('screen-chat');
  let pipWindow = null;

  if (!pipBtn) return;

  async function openPiP() {
    if (!('documentPictureInPicture' in window)) {
      if (autoPipToggle) autoPipToggle.checked = false;
      showToast('Ваш браузер не поддерживает Picture-in-Picture (нужен Chrome 116+)');
      return;
    }

    if (pipWindow) return;

    try {
      pipWindow = await documentPictureInPicture.requestWindow({
        width: 450,
        height: 600,
      });

      const styles = [...document.styleSheets];
      for (const styleSheet of styles) {
        const style = document.createElement('style');
        try {
          style.textContent = [...styleSheet.cssRules].map(rule => rule.cssText).join('');
        } catch {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = styleSheet.href;
          pipWindow.document.head.appendChild(link);
          continue;
        }
        pipWindow.document.head.appendChild(style);
      }

      const baseStyle = document.createElement('style');
      baseStyle.textContent = `
        body { background: var(--bg-color); height: 100vh; display: flex; flex-direction: column; padding: 10px; overflow: hidden; margin: 0; }
        #screen-chat { display: flex; flex-direction: column; height: 100%; }
      `;
      pipWindow.document.head.appendChild(baseStyle);

      pipWindow.document.body.appendChild(screenChat); 
      
      pipBtn.textContent = '🔙';
      pipBtn.title = 'Вернуть в основное окно';

      pipWindow.document.getElementById('user-input').focus();

      pipWindow.addEventListener('pagehide', () => {
        document.getElementById('app').appendChild(screenChat);
        pipBtn.textContent = '🪟';
        pipBtn.title = 'Вынести в отдельное окно';
        pipWindow = null;
        document.getElementById('user-input').focus();
      });

    } catch (error) {
      console.error('Ошибка PiP:', error);
      if (autoPipToggle && autoPipToggle.checked) {
        autoPipToggle.checked = false;
        showToast('Браузер заблокировал автоматическое открытие. Нажмите 🪟 вручную.');
      }
    }
  }

  pipBtn.addEventListener('click', async () => {
    if (pipWindow) {
      pipWindow.close();
    } else {
      await openPiP();
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (autoPipToggle && autoPipToggle.checked) {
      if (document.visibilityState === 'hidden' && !pipWindow) {
        await openPiP();
      }
    }
  });
}