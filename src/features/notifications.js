export function initNotifications() {
  const notifyBtn = document.getElementById('notify-btn');
  if (!notifyBtn) return;

  // Проверяем статус при загрузке
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      notifyBtn.classList.add('active');
      notifyBtn.title = 'Уведомления включены';
    }
  } else {
    notifyBtn.style.display = 'none'; // Скрываем, если браузер не поддерживает
    return;
  }

  // Обработчик клика по колокольчику
  notifyBtn.addEventListener('click', async () => {
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        notifyBtn.classList.add('active');
        notifyBtn.title = 'Уведомления включены';
        new Notification('Уведомления включены!', { body: 'Теперь вы узнаете, когда ИИ ответит.' });
      }
    } else {
      new Notification('Уведомления уже включены', { body: 'Всё работает!' });
    }
  });
}

// Экспортируем функцию для системных уведомлений
export function showSystemNotification(title = 'Ответ готов!', body = 'ИИ закончил генерацию ответа в чате.') {
  // Убрали проверку document.hidden, чтобы уведомление выскакивало сразу
  if (Notification.permission === 'granted') {
    new Notification(title, { 
      body: body,
      icon: '/icon-192.png' 
    });
  }
}