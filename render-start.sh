#!/usr/bin/env sh
set -e

python manage.py migrate --noinput

exec gunicorn nowlex_erp_mini.wsgi:application --bind 0.0.0.0:${PORT}
