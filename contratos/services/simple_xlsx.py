from __future__ import annotations

import datetime
import io
import re
import zipfile
from typing import Iterable, Sequence
from xml.sax.saxutils import escape


def _excel_column_name(index: int) -> str:
    if index < 1:
        raise ValueError("Excel columns are 1-based.")
    result = []
    while index:
        index, remainder = divmod(index - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))


def _sanitize_sheet_name(value: str) -> str:
    raw = re.sub(r"[\[\]\:\*\?\/\\\\]", " ", str(value or "").strip())
    raw = re.sub(r"\s+", " ", raw).strip()
    return (raw or "Planilha")[:31]


def _serialize_inline_text_cell(reference: str, value: object, *, style_id: int | None = None) -> str:
    style_attr = f' s="{style_id}"' if style_id is not None else ""
    text = escape("" if value is None else str(value))
    return (
        f'<c r="{reference}" t="inlineStr"{style_attr}>'
        f'<is><t xml:space="preserve">{text}</t></is>'
        f"</c>"
    )


def _quote_sheet_reference(value: str) -> str:
    return "'" + str(value or "").replace("'", "''") + "'"


def _serialize_worksheet_xml(
    rows: Sequence[Sequence[object]],
    *,
    data_validations: Sequence[dict] | None = None,
    freeze_header: bool = False,
    auto_filter: bool = False,
    style_header: bool = False,
) -> str:
    normalized_rows = [list(row) for row in rows]
    column_count = max((len(row) for row in normalized_rows), default=1)
    row_count = max(len(normalized_rows), 1)

    column_widths = []
    for column_index in range(column_count):
        max_length = max(
            len(str(row[column_index] if column_index < len(row) else ""))
            for row in (normalized_rows or [[""]])
        )
        column_widths.append(min(max(max_length + 3, 12), 42))

    xml_rows = []
    for row_index, row in enumerate(normalized_rows, start=1):
        serialized_cells = []
        for column_index in range(1, column_count + 1):
            cell_reference = f"{_excel_column_name(column_index)}{row_index}"
            value = row[column_index - 1] if column_index - 1 < len(row) else ""
            serialized_cells.append(
                _serialize_inline_text_cell(
                    cell_reference,
                    value,
                    style_id=1 if style_header and row_index == 1 else None,
                )
            )
        xml_rows.append(f'<row r="{row_index}">{"".join(serialized_cells)}</row>')

    if not xml_rows:
        xml_rows.append(f'<row r="1">{_serialize_inline_text_cell("A1", "")}</row>')

    last_cell = f"{_excel_column_name(column_count)}{row_count}"
    cols_xml = "".join(
        f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>'
        for idx, width in enumerate(column_widths, start=1)
    )

    data_validations = list(data_validations or [])
    validations_xml = ""
    if data_validations:
        serialized_validations = []
        for validation in data_validations:
            sqref = escape(str(validation.get("sqref") or "").strip())
            formula1 = escape(str(validation.get("formula1") or "").strip())
            if not sqref or not formula1:
                continue
            serialized_validations.append(
                '<dataValidation type="list" allowBlank="1" showErrorMessage="1" '
                f'sqref="{sqref}"><formula1>{formula1}</formula1></dataValidation>'
            )
        if serialized_validations:
            validations_xml = (
                f'<dataValidations count="{len(serialized_validations)}">'
                f'{"".join(serialized_validations)}'
                "</dataValidations>"
            )

    if freeze_header:
        sheet_views_xml = (
            '<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>'
            "</sheetView></sheetViews>"
        )
    else:
        sheet_views_xml = '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'

    auto_filter_xml = f'<autoFilter ref="A1:{last_cell}"/>' if auto_filter else ""

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<dimension ref="A1:{last_cell}"/>'
        f"{sheet_views_xml}"
        '<sheetFormatPr defaultRowHeight="15"/>'
        f"<cols>{cols_xml}</cols>"
        f'<sheetData>{"".join(xml_rows)}</sheetData>'
        f"{auto_filter_xml}"
        f"{validations_xml}"
        "</worksheet>"
    )


def build_simple_xlsx(
    sheet_name: str,
    headers: Sequence[object],
    rows: Iterable[Sequence[object]],
    *,
    data_validations: Sequence[dict] | None = None,
    auto_filter: bool = True,
) -> bytes:
    rows = [list(row) for row in rows]
    headers = list(headers)
    if not headers:
        raise ValueError("headers cannot be empty")

    normalized_sheet_name = _sanitize_sheet_name(sheet_name)
    main_rows = [headers, *rows]

    data_validations = list(data_validations or [])
    hidden_sheet_name = "_validacoes"
    hidden_list_columns: list[list[str]] = []
    hidden_list_indexes: dict[tuple[str, ...], int] = {}
    hidden_list_names: dict[int, str] = {}
    normalized_validations = []

    for validation in data_validations:
        sqref = str(validation.get("sqref") or "").strip()
        formula1 = str(validation.get("formula1") or "").strip()
        if not sqref:
            continue
        if not formula1:
            values = []
            for raw_value in validation.get("values") or []:
                text = str(raw_value or "").strip()
                if text:
                    values.append(text)
            if values:
                values_key = tuple(values)
                hidden_column_index = hidden_list_indexes.get(values_key)
                if hidden_column_index is None:
                    hidden_column_index = len(hidden_list_columns) + 1
                    hidden_list_indexes[values_key] = hidden_column_index
                    hidden_list_columns.append(values)
                validation_name = hidden_list_names.get(hidden_column_index)
                if not validation_name:
                    validation_name = f"VALIDACAO_{hidden_column_index}"
                    hidden_list_names[hidden_column_index] = validation_name
                column_name = _excel_column_name(hidden_column_index)
                formula1 = validation_name
        if sqref and formula1:
            normalized_validations.append({"sqref": sqref, "formula1": formula1})

    worksheet_xml = _serialize_worksheet_xml(
        main_rows,
        data_validations=normalized_validations,
        freeze_header=True,
        auto_filter=bool(auto_filter),
        style_header=True,
    )

    workbook_sheets = [
        {"name": normalized_sheet_name, "path": "worksheets/sheet1.xml", "hidden": False},
    ]
    worksheets = [("xl/worksheets/sheet1.xml", worksheet_xml)]
    if hidden_list_columns:
        max_hidden_length = max((len(column) for column in hidden_list_columns), default=1)
        hidden_rows = []
        for row_index in range(max_hidden_length):
            hidden_rows.append(
                [
                    column[row_index] if row_index < len(column) else ""
                    for column in hidden_list_columns
                ]
            )
        workbook_sheets.append({"name": hidden_sheet_name, "path": "worksheets/sheet2.xml", "hidden": True})
        worksheets.append(
            (
                "xl/worksheets/sheet2.xml",
                _serialize_worksheet_xml(hidden_rows),
            )
        )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>'
        "</fonts>"
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1D4F91"/><bgColor indexed="64"/></patternFill></fill>'
        "</fills>"
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
        "</cellXfs>"
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )

    workbook_sheets_xml = []
    workbook_rels = []
    content_type_overrides = []
    for index, sheet in enumerate(workbook_sheets, start=1):
        state_attr = ' state="hidden"' if sheet.get("hidden") else ""
        workbook_sheets_xml.append(
            f'<sheet name="{escape(str(sheet["name"]))}" sheetId="{index}" r:id="rId{index}"{state_attr}/>'
        )
        workbook_rels.append(
            f'<Relationship Id="rId{index}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
            f'Target="{sheet["path"]}"/>'
        )
        content_type_overrides.append(
            f'<Override PartName="/xl/{sheet["path"]}" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )

    defined_names_xml = ""
    if hidden_list_columns:
        defined_name_entries = []
        for hidden_column_index, values in enumerate(hidden_list_columns, start=1):
            validation_name = hidden_list_names.get(hidden_column_index)
            if not validation_name or not values:
                continue
            column_name = _excel_column_name(hidden_column_index)
            defined_name_entries.append(
                f'<definedName name="{escape(validation_name)}">'
                f"{escape(_quote_sheet_reference(hidden_sheet_name))}!${column_name}$1:${column_name}${len(values)}"
                "</definedName>"
            )
        if defined_name_entries:
            defined_names_xml = f'<definedNames>{"".join(defined_name_entries)}</definedNames>'

    styles_rel_id = len(workbook_sheets) + 1
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<fileVersion appName="xl"/>'
        '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>'
        f'<sheets>{"".join(workbook_sheets_xml)}</sheets>'
        f"{defined_names_xml}"
        "</workbook>"
    )

    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{"".join(workbook_rels)}'
        f'<Relationship Id="rId{styles_rel_id}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        "</Relationships>"
    )

    created_at = datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    core_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        '<dc:creator>CFF System</dc:creator>'
        '<cp:lastModifiedBy>CFF System</cp:lastModifiedBy>'
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{created_at}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{created_at}</dcterms:modified>'
        "</cp:coreProperties>"
    )

    app_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        '<Application>Microsoft Excel</Application>'
        "</Properties>"
    )

    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" '
        'Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" '
        'Target="docProps/app.xml"/>'
        "</Relationships>"
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        f'{"".join(content_type_overrides)}'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        "</Types>"
    )

    output = io.BytesIO()
    with zipfile.ZipFile(output, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", rels_xml)
        archive.writestr("docProps/app.xml", app_xml)
        archive.writestr("docProps/core.xml", core_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        archive.writestr("xl/styles.xml", styles_xml)
        for worksheet_path, worksheet_content in worksheets:
            archive.writestr(worksheet_path, worksheet_content)
    return output.getvalue()
