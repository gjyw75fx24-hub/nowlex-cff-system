# Diagnóstico do LibreOffice no Render

## Problema
O PDF gerado a partir do DOCX está com formato diferente porque o LibreOffice não está sendo encontrado no servidor de produção.

## Solução Implementada

### 1. Aptfile Atualizado
Adicionados pacotes necessários:
```
libreoffice
libreoffice-writer
libreoffice-common
libreoffice-core
default-jre-headless
```

### 2. Build Script Atualizado
O `build.sh` agora verifica se o LibreOffice foi instalado corretamente e mostra diagnósticos.

### 3. Código Atualizado
- Busca o LibreOffice em mais localizações possíveis
- Adiciona logs detalhados para diagnóstico
- Mostra PATH e localizações tentadas se não encontrar

## Como Verificar no Render

### Via Dashboard do Render:
1. Acesse o dashboard do Render
2. Vá em "Shell" do seu serviço
3. Execute:
   ```bash
   which soffice
   which libreoffice
   ls -la /usr/bin/ | grep libre
   ls -la /usr/bin/ | grep soffice
   ```

### Via Logs de Build:
Após o próximo deploy, verifique os logs de build. Você deve ver:
```
=== Verificando instalação do LibreOffice ===
✓ LibreOffice encontrado: /usr/bin/soffice
LibreOffice 7.x.x.x
```

### Via Logs de Aplicação:
Quando gerar um PDF, verifique os logs. Deve aparecer:
```
INFO LibreOffice encontrado em: /usr/bin/soffice
INFO LibreOffice: conversão bem-sucedida (PDF: XXXXX bytes)
```

## Se o LibreOffice NÃO for Encontrado

### Opção 1: Verificar se Aptfile está sendo detectado
O Render detecta automaticamente o Aptfile na raiz do projeto. Verifique se:
- O arquivo está na raiz (não em subpasta)
- O nome é exatamente `Aptfile` (case-sensitive)
- Não tem extensão (.txt, etc)

### Opção 2: Instalação Manual (IMPLEMENTADO)
O `build.sh` agora tenta instalar o LibreOffice automaticamente se o Aptfile não funcionar.

**NOTA**: No plano Standard do Render, você tem permissões sudo para instalar pacotes. O script agora faz isso automaticamente.

### Opção 3: Usar Gotenberg (alternativa)
Se LibreOffice continuar não funcionando, considere usar Gotenberg (serviço Docker separado) como estava configurado anteriormente.

## Tamanhos Esperados

### Com LibreOffice (CORRETO):
- DOCX: ~3MB
- PDF: ~2-3MB (tamanho similar, formatação preservada)

### Com Fallback Python mammoth+xhtml2pdf (INCORRETO):
- DOCX: ~3MB
- PDF: ~13KB (perda massiva de conteúdo/formatação)

## Próximos Passos

1. **Fazer commit dessas mudanças**
2. **Fazer push para o Render**
3. **Verificar logs de build** para confirmar instalação do LibreOffice
4. **Testar geração de PDF** e verificar o tamanho do arquivo gerado
5. **Verificar logs de aplicação** para confirmar que está usando LibreOffice

## Comandos para Commit

```bash
git add Aptfile build.sh contratos/views.py contratos/services/peticao_combo.py
git commit -m "Fix: Adiciona diagnóstico e busca expandida do LibreOffice"
git push
```

Após o deploy, aguarde ~5 minutos e teste a geração de PDF novamente.
