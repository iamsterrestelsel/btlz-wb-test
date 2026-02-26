# Шаблон для выполнения тестового задания

## Описание
Настроить .env файл: добавить WB Token, ID google таблицы
Также положить json ключ для Google Cloud Console Service Account в папку src/google/utils, указать название в .env GOOGLE_APPLICATION_CREDENTIALS
Запустить postgress:
```bash
docker compose up -d --build postgres
```
Собрать проект через:
```bash
docker compose up -d --build app
```
Запустить с помощью команды:
```bash
npm run dev
```

## Команды:

Запуск базы данных:
```bash
docker compose up -d --build postgres
```

Для выполнения миграций и сидов не из контейнера:
```bash
npm run knex:dev migrate latest
```

```bash
npm run knex:dev seed run
```
Также можно использовать и остальные команды (`migrate make <name>`,`migrate up`, `migrate down` и т.д.)

Для запуска приложения в режиме разработки:
```bash
npm run dev
```

Запуск проверки самого приложения:
```bash
docker compose up -d --build app
```

Для финальной проверки рекомендую:
```bash
docker compose down --rmi local --volumes
docker compose up --build
```

PS: С наилучшими пожеланиями!
