#!/bin/bash
set -e

pip install -r requirements.txt
poetry run python manage.py migrate
