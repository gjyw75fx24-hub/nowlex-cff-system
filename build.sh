#!/usr/bin/env bash
# Script de build para Render

set -o errexit  # Sai em caso de erro

echo "=== Verificando instalação do LibreOffice ==="
# Verifica se LibreOffice foi instalado via Aptfile
if command -v soffice &> /dev/null; then
    echo "✓ LibreOffice encontrado via Aptfile: $(which soffice)"
    soffice --version
elif command -v libreoffice &> /dev/null; then
    echo "✓ LibreOffice encontrado via Aptfile: $(which libreoffice)"
    libreoffice --version
else
    echo "⚠️  LibreOffice NÃO encontrado via Aptfile!"
    echo "Tentando instalar manualmente (plano Standard)..."

    # Atualiza lista de pacotes
    sudo apt-get update -qq

    # Instala LibreOffice (pode levar alguns minutos)
    echo "Instalando LibreOffice e dependências..."
    sudo apt-get install -y -qq \
        libreoffice \
        libreoffice-writer \
        libreoffice-core \
        libreoffice-common \
        default-jre-headless \
        > /dev/null 2>&1

    # Verifica novamente
    if command -v soffice &> /dev/null; then
        echo "✓ LibreOffice instalado com sucesso: $(which soffice)"
        soffice --version
    elif command -v libreoffice &> /dev/null; then
        echo "✓ LibreOffice instalado com sucesso: $(which libreoffice)"
        libreoffice --version
    else
        echo "❌ ERRO: Falha ao instalar LibreOffice"
        echo "Verificando localizações alternativas..."
        find /usr -name "*soffice*" 2>/dev/null || echo "Não encontrado"
        echo "A conversão de PDF usará fallback Python (formatação limitada)"
    fi
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
