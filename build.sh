#!/usr/bin/env bash
# Script de build para Render

set -o errexit  # Sai em caso de erro

echo "=== Verificando instalação do LibreOffice ==="
# Verifica se LibreOffice foi instalado via Aptfile
if command -v soffice &> /dev/null; then
    echo "✓ LibreOffice encontrado: $(which soffice)"
    soffice --version
elif command -v libreoffice &> /dev/null; then
    echo "✓ LibreOffice encontrado: $(which libreoffice)"
    libreoffice --version
else
    echo "⚠️  AVISO: LibreOffice NÃO encontrado!"
    echo "Verificando se está instalado em caminhos alternativos..."
    find /opt -name "soffice" 2>/dev/null || echo "Não encontrado em /opt"
    find /usr -name "soffice" 2>/dev/null || echo "Não encontrado em /usr"
fi

echo ""
echo "=== Instalando dependências Python ==="
pip install -r requirements.txt

echo ""
echo "=== Coletando arquivos estáticos ==="
python manage.py collectstatic --no-input

echo ""
echo "=== Executando migrações do banco de dados ==="
python manage.py migrate

echo ""
echo "=== Build concluído com sucesso ==="
