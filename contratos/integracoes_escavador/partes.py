import re


def _digits(value):
    return re.sub(r"\D", "", str(value or ""))


def normalize_documento_from_payload(payload: dict | None) -> str:
    if not isinstance(payload, dict):
        return ""

    for key in ("cpf", "cnpj", "documento"):
        value = payload.get(key)
        if isinstance(value, dict):
            value = value.get("numero") or value.get("valor") or value.get("documento")
        if isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    candidate = item.get("numero") or item.get("valor") or item.get("documento")
                else:
                    candidate = item
                if _digits(candidate):
                    return str(candidate).strip()
            continue
        if _digits(value):
            return str(value).strip()

    return ""


def normalize_tipo_polo_from_payload(payload: dict | None) -> str:
    polo_raw = str((payload or {}).get("polo") or (payload or {}).get("tipo") or "").upper()
    if polo_raw == "ATIVO" or "AUTOR" in polo_raw:
        return "ATIVO"
    if polo_raw == "PASSIVO" or "REU" in polo_raw or "RÉU" in polo_raw:
        return "PASSIVO"
    return ""


def normalize_tipo_pessoa_from_payload(payload: dict | None, documento: str = "") -> str:
    tipo_raw = str((payload or {}).get("tipo_pessoa") or "").upper().strip()
    if tipo_raw in {"FISICA", "PF"}:
        return "PF"
    if tipo_raw in {"JURIDICA", "PJ"}:
        return "PJ"
    digits = _digits(documento)
    if len(digits) == 11:
        return "PF"
    if len(digits) == 14:
        return "PJ"
    return ""


def collect_partes_from_escavador_payload(dados_api: dict | None) -> list[dict]:
    if not isinstance(dados_api, dict):
        return []

    merged: dict[tuple[str, str], dict] = {}

    def merge_payload(payload: dict | None, prefer_documento: bool = True):
        if not isinstance(payload, dict):
            return
        nome = str(payload.get("nome") or "").strip()
        tipo_polo = normalize_tipo_polo_from_payload(payload)
        if not nome or not tipo_polo:
            return

        documento = normalize_documento_from_payload(payload)
        tipo_pessoa = normalize_tipo_pessoa_from_payload(payload, documento)
        endereco = str(payload.get("endereco") or "").strip()
        key = (nome.casefold(), tipo_polo)

        current = merged.get(key)
        if not current:
            merged[key] = {
                "nome": nome,
                "tipo_polo": tipo_polo,
                "tipo_pessoa": tipo_pessoa,
                "documento": documento,
                "endereco": endereco,
            }
            return

        if documento and (prefer_documento or not current.get("documento")):
            current["documento"] = documento
        if tipo_pessoa and not current.get("tipo_pessoa"):
            current["tipo_pessoa"] = tipo_pessoa
        if endereco and not current.get("endereco"):
            current["endereco"] = endereco

    for fonte in dados_api.get("fontes", []) or []:
        for envolvido in fonte.get("envolvidos", []) or []:
            merge_payload(envolvido, prefer_documento=True)

    for parte in dados_api.get("partes_envolvidas", []) or []:
        merge_payload(parte, prefer_documento=True)

    return list(merged.values())
