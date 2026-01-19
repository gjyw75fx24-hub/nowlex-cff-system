#!/usr/bin/env bash
# Script de build para Render

set -o errexit  # Sai em caso de erro

# NOTA IMPORTANTE: LibreOffice é instalado automaticamente pelo Render
# através do arquivo Aptfile na raiz do projeto (detectado automaticamente).
# Não é necessário instalar manualmente aqui.

# Instalar dependências Python
pip install -r requirements.txt

# Coletar arquivos estáticos
python manage.py collectstatic --no-input

# Executar migrações do banco de dados
python manage.py migrate
