#!/bin/bash
poetry run python manage.py migrate contratos
pip install -r requirements.txt
