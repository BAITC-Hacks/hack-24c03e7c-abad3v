import { app } from './app.js';

const port = Number(process.env.PORT || 3001);
const server = app.listen(port, (error) => {
  if (error) {
    console.error(error.code === 'EADDRINUSE'
      ? `AI Sana API: порт ${port} уже занят (EADDRINUSE). Остановите предыдущий backend через Ctrl+C в его терминале перед повторным npm run dev. Если backend уже запущен и нужен только frontend, используйте npm run dev:client из корня проекта.`
      : `AI Sana API не запущен: ${error.code || error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`AI Sana API listening on http://localhost:${server.address().port}`);
});
