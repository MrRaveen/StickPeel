## docker
ravinjayasanka@vlte6:~$ docker run -d \
  --name postgres-dev \
  -e POSTGRES_USER=raveenjayasanka41 \
  -e POSTGRES_PASSWORD='123456789' \
  -e POSTGRES_DB=launchbase \
  -p 5432:5432 \
  postgres:15

## create the DB in the console
## backend - 8000
cd api
uv sync
cp .env.example .env
uv run alembic revision --autogenerate -m "create_initial_models"
uv run alembic upgrade head
uv run manage.py seed
uv run fastapi dev --reload-dir app

## frontend - site - 3000
cd site
npm install
npm run dev -- --port 3000

## frontend - site -3001
cd app
npm install
npm run dev -- --port 3001

## frontend - site - 3002
cd internal
npm install
npm run dev -- --port 3002

