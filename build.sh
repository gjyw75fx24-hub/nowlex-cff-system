#!/usr/bin/env bash
# Script de build para Render

set -o errexit  # Sai em caso de erro

# Dependências de sistema (LibreOffice para conversão DOCX->PDF)
apt-get update
apt-get install -y libreoffice-core libreoffice-writer fonts-dejavu-core

# Instalar dependências Python
pip install -r requirements.txt

# Coletar arquivos estáticos
python manage.py collectstatic --no-input

# Executar migrações do banco de dados
python manage.py migrate
