#!/usr/bin/env python3
import requests
import json
import os
import time
import argparse
import urllib.parse

# Authentication and API details
# Escavador API
ESCAVADOR_AUTH_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiYmVhMTVkMGJiNTJlZWNjNWIwN2ZmNTQ0MWY3MWE4NDczNWNmMTQ2MmRlYjM5ZDBjMTg1MDQ3ZmYzYzBiNmNhNjllYTU1NWQxZTM2ZGJmNzciLCJpYXQiOjE3NDU1Mjg1NjQuNjg2NzQ1LCJuYmYiOjE3NDU1Mjg1NjQuNjg2NzQ2LCJleHAiOjIwNjEwNjEzNjQuNjg0ODMyLCJzdWIiOiIyNDQyNjgwIiwic2NvcGVzIjpbImFjZXNzYXJfYXBpX3BhZ2EiXX0.vc1L9skh5YGr36hCJAl0pX9czlnrVWfz7rvmfeWkfE14G_bSMdmq7bjQBwzoRmu00zACH-jIOf0seH3RK3LfZTwxRchXMqD6VGmipZHv5kJjfmBnrS7cQUK44NA_0nbMOJsysGeBU4pU8UOzDjj5Snb-Jm2TJS06a8WPj-N4JYhr6gAZXVsBomuAR6AMMjb4DI-zR8oMsT-tOvjGeBOgShVCKNM4mLWgy9F9dvm5BABBXlpkunPZDvUHlUlr6ME889ynqWxuJYZyuLzGbB_h_8Rq9iI0b0Raxk8c9YaJy88n0SXnHTvB3SNXflheotEFDFHTq2xX2262QcQAZMmyvmO_FpGd6npc15_9d7DG4SGpRb2wszmBfwR_5KSi1VxttAwqSjnC-XU_3_F91yxIUEmgFFS1ZA3brlJn4LAEp6_ya3JC0WZLu0jCxuB4BQ0ZwGoLoLzlAjnvqoyxzOAzQOagGfI8gRoYaUek6Oyf-5ve1NSI_GhaUvy9F3NsITLKRl1jxVFUFDhcD8GaS2cUXOqBKLQZHMyS0TxArFZpDyqyuNjj9pntQaKXa_k6AAQ9DZ_IBy8dIa8jN2C_md0e4iwwVesARlxWSor_Oxo8oR2HwER0BiHWp9NJnGqtw3-OqMhcN9515F7wtvAjeWY0f0yWk86d6yHLM_lwISGOV0U'
ESCAVADOR_HEADERS = {
    'Authorization': f'Bearer {ESCAVADOR_AUTH_TOKEN}',
    'X-Requested-With': 'XMLHttpRequest',
}

# JusBrasil API
JUSBRASIL_API_BASE_URL = "https://op.digesto.com.br/api/base-judicial/tribproc/"
JUSBRASIL_BEARER_TOKEN = "48ee49ab-dc7b-4dd6-b8d9-a3124258a474"
JUSBRASIL_HEADERS = {
    "Authorization": f"Bearer {JUSBRASIL_BEARER_TOKEN}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# Base directory to save responses
BASE_OUTPUT_DIR = 'files/escavador_data'
# This will be updated in main based on project_name parameter
OUTPUT_DIR = BASE_OUTPUT_DIR


def make_request(url, headers=None):
    '''Make a request to an API.'''
    headers = headers or ESCAVADOR_HEADERS
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f'Error making request: {e}')
        return None


def get_process_from_jusbrasil(cnj):
    '''Get process information from JusBrasil API with two different requests.'''
    formatted_cnj = format_cnj(cnj)
    # Create process-specific directory
    process_dir = os.path.join(OUTPUT_DIR, formatted_cnj)
    os.makedirs(process_dir, exist_ok=True)
    
    success = False
    
    # First request - with anexos_texto=false
    url_without_anexos = f"{JUSBRASIL_API_BASE_URL}{urllib.parse.quote(formatted_cnj)}?anexos_texto=false"
    print(f'Fetching process from JusBrasil API (without text annexes) for {formatted_cnj}...')
    data_without_anexos = make_request(url_without_anexos, JUSBRASIL_HEADERS)
    
    if data_without_anexos:
        # Save first response
        jusbrasil_filename = os.path.join(process_dir, 'jusbrasil.json')
        with open(jusbrasil_filename, 'w', encoding='utf-8') as f:
            json.dump(data_without_anexos, f, ensure_ascii=False, indent=2)
        print(f'Saved JusBrasil data (without text annexes) for {formatted_cnj} to {jusbrasil_filename}')
        success = True
    else:
        print(f'Failed to get JusBrasil data (without text annexes) for {formatted_cnj}')
    
    # Add a small delay between requests
    time.sleep(1)
    
    # Second request - with full content
    url_with_anexos = f"{JUSBRASIL_API_BASE_URL}{urllib.parse.quote(formatted_cnj)}"
    print(f'Fetching process from JusBrasil API (with text annexes) for {formatted_cnj}...')
    data_with_anexos = make_request(url_with_anexos, JUSBRASIL_HEADERS)
    
    if data_with_anexos:
        # Save second response
        jusbrasil_full_filename = os.path.join(process_dir, 'jusbrasil-com-texto-anexo.json')
        with open(jusbrasil_full_filename, 'w', encoding='utf-8') as f:
            json.dump(data_with_anexos, f, ensure_ascii=False, indent=2)
        print(f'Saved JusBrasil data (with text annexes) for {formatted_cnj} to {jusbrasil_full_filename}')
        success = True
    else:
        print(f'Failed to get JusBrasil data (with text annexes) for {formatted_cnj}')
    
    return success


def save_response(data, cnj, page=None):
    '''Save response data to a JSON file.'''
    # Create process-specific directory
    process_dir = os.path.join(OUTPUT_DIR, cnj)
    os.makedirs(process_dir, exist_ok=True)

    if page is None or page == 1:
        filename = os.path.join(process_dir, 'movimentacoes.json')
    else:
        filename = os.path.join(process_dir, f'movimentacoes-pagina-{page}.json')

    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(
        f'Saved {cnj} {("page " + str(page)) if page and page > 1 else ""} to {filename}'
    )


def format_cnj(cnj):
    '''Format CNJ number by removing special characters.'''
    return ''.join(c for c in cnj if c.isdigit())


def get_process_details(cnj):
    '''Get process details (cover info) by CNJ number.'''
    formatted_cnj = format_cnj(cnj)
    url = f'https://api.escavador.com/api/v2/processos/numero_cnj/{formatted_cnj}'

    print(f'Fetching process details for {formatted_cnj}...')
    data = make_request(url)
    
    if data:
        # Create process-specific directory
        process_dir = os.path.join(OUTPUT_DIR, formatted_cnj)
        os.makedirs(process_dir, exist_ok=True)
        
        # Save with a different filename to distinguish from movements
        details_filename = os.path.join(process_dir, 'escavador-detalhes.json')
        with open(details_filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f'Saved details for {formatted_cnj} to {details_filename}')
        return True
    else:
        print(f'Failed to get details for {formatted_cnj}')
        return False


def get_process_movements(cnj, follow_pagination=False):
    '''Get process movements by CNJ number.'''
    formatted_cnj = format_cnj(cnj)
    url = f'https://api.escavador.com/api/v2/processos/numero_cnj/{formatted_cnj}/movimentacoes'

    print(f'Fetching process movements for {formatted_cnj}...')
    page = 1
    success = False

    # Get first page
    data = make_request(url)
    if data:
        save_response(data, formatted_cnj)
        success = True

        # Follow pagination if requested
        if follow_pagination and 'links' in data and data['links'].get('next'):
            while data['links'].get('next'):
                page += 1
                print(f'Fetching page {page} for process {formatted_cnj}...')
                # Small delay to avoid hitting rate limits
                time.sleep(1)

                next_url = data['links']['next']
                data = make_request(next_url)

                if data:
                    save_response(data, formatted_cnj, page)
                else:
                    print(f'Failed to get page {page} for {formatted_cnj}')
                    break
    else:
        print(f'Failed to get movement data for {formatted_cnj}')

    return success


def get_process_by_cnj(cnj, follow_pagination=False, skip_jusbrasil=False):
    '''Get all process information by CNJ number from all available APIs.'''
    formatted_cnj = format_cnj(cnj)
    print(f'Processing CNJ: {formatted_cnj}')
    
    # Create base output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Track success of each API call
    success_count = 0
    total_apis = 3 if not skip_jusbrasil else 2
    
    # 1. Get Escavador details (cover info)
    if get_process_details(cnj):
        success_count += 1
    
    # 2. Get Escavador movements
    if get_process_movements(cnj, follow_pagination):
        success_count += 1
    
    # 3. Get JusBrasil data (if not skipped)
    if not skip_jusbrasil:
        if get_process_from_jusbrasil(cnj):
            success_count += 1
    else:
        print(f'Skipping JusBrasil search for {formatted_cnj} as requested')
    
    # Add a small delay between processing different APIs
    time.sleep(1)
    
    print(f'Completed processing {formatted_cnj} with {success_count}/{total_apis} successful API calls')
    
    # Return overall success (at least one API returned data)
    return success_count > 0


def process_cnj_list(file_path, follow_pagination=False, skip_jusbrasil=False):
    '''Process a list of CNJ numbers from a file.'''
    try:
        with open(file_path, 'r') as f:
            cnjs = [line.strip() for line in f.readlines()]

        print(f'Found {len(cnjs)} CNJ numbers to process')
        print(
            f'Pagination following is {"ENABLED" if follow_pagination else "DISABLED"}'
        )
        print(
            f'JusBrasil search is {"DISABLED" if skip_jusbrasil else "ENABLED"}'
        )

        success_count = 0
        for i, cnj in enumerate(cnjs):
            if cnj:  # Skip empty lines
                print(f'Processing {i+1}/{len(cnjs)}: {cnj}')
                if get_process_by_cnj(cnj, follow_pagination, skip_jusbrasil):
                    success_count += 1

                # Add a small delay to avoid hitting rate limits
                time.sleep(1)

        print(
            f'Completed processing {success_count}/{len(cnjs)} CNJ numbers successfully'
        )

    except FileNotFoundError:
        print(f'File not found: {file_path}')
    except Exception as e:
        print(f'Error processing CNJ list: {e}')


def update_output_dir(project_name):
    """Update the global OUTPUT_DIR based on project name."""
    global OUTPUT_DIR
    if project_name:
        OUTPUT_DIR = os.path.join(BASE_OUTPUT_DIR, project_name)
        print(f'Using project directory: {OUTPUT_DIR}')
    
    # Create base output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def main():
    """Main function to handle command-line arguments and execute the script."""
    parser = argparse.ArgumentParser(
        description='Download process information from Escavador API by CNJ numbers'
    )
    
    # Create a mutually exclusive group for input options
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument(
        '--file', '-f',
        dest='file_path',
        help='Path to a file containing CNJ numbers (one per line)',
    )
    input_group.add_argument(
        '--cnj', '-c',
        dest='cnj',
        help='Single CNJ number to process',
    )
    
    parser.add_argument(
        '--follow-pagination',
        '-p',
        action='store_true',
        help='Follow pagination links to download all pages of data',
    )
    
    parser.add_argument(
        '--skip-jusbrasil',
        '-s',
        action='store_true',
        help='Skip JusBrasil API queries',
    )
    
    parser.add_argument(
        '--project', '-n',
        dest='project_name',
        help='Optional project name to organize downloaded files (creates a subdirectory)',
    )

    args = parser.parse_args()
    
    # Update OUTPUT_DIR if project_name is provided
    update_output_dir(args.project_name)
    
    return args


if __name__ == '__main__':
    args = main()
    
    if args.file_path:
        process_cnj_list(args.file_path, args.follow_pagination, args.skip_jusbrasil)
    elif args.cnj:
        # Process a single CNJ directly
        get_process_by_cnj(args.cnj, args.follow_pagination, args.skip_jusbrasil)
    else:
        print(
            'Usage: python download_escavador_by_cnj.py --file <cnj_list_file> [--follow-pagination] [--skip-jusbrasil] [--project <project_name>]'
        )
        print(
            'OR: python download_escavador_by_cnj.py --cnj <cnj_number> [--follow-pagination] [--skip-jusbrasil] [--project <project_name>]'
        )
        print(
            'Examples:'
        )
        print(
            '  python download_escavador_by_cnj.py --file files/lista_cnjs.txt --follow-pagination'
        )
        print(
            '  python download_escavador_by_cnj.py --cnj 00011111120208260123 --project meu-projeto'
        )
        print(
            '  python download_escavador_by_cnj.py --cnj 00011111120208260123 --follow-pagination --skip-jusbrasil --project meu-projeto'
        )