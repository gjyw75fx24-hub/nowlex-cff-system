from pathlib import Path
import os
from dotenv import load_dotenv
import dj_database_url

# Carrega as variáveis de ambiente do arquivo .env
load_dotenv()

# Sentry configuration
sentry_enabled = os.getenv('SENTRY_ENABLED', 'False').lower() in ('true', '1', 'yes')
if sentry_enabled:
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=os.getenv('SENTRY_DSN'),
        environment=os.getenv('SENTRY_ENVIRONMENT', 'dev'),
        integrations=[
            DjangoIntegration(),
        ],
        traces_sample_rate=0.1,
        send_default_pii=True,
    )

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv('SECRET_KEY', 'django-insecure-change-me-in-production')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.getenv('DEBUG', 'False').lower() in ('true', '1', 'yes')

ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', '').split(',') if os.getenv('ALLOWED_HOSTS') else []

# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'storages',
    'contratos.apps.ContratosConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',  # Serve arquivos estáticos em produção
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'nowlex_erp_mini.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'nowlex_erp_mini.wsgi.application'

# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

# Database - Suporta DATABASE_URL (Render) ou variáveis individuais (local)
DATABASE_URL = os.getenv('DATABASE_URL')
CARTEIRA_DATABASE_URL = os.getenv('CARTEIRA_DATABASE_URL')
CARTEIRA_DB_NAME = os.getenv('CARTEIRA_DB_NAME')

if DATABASE_URL:
    DATABASES = {
        'default': dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME'),
            'USER': os.getenv('DB_USER'),
            'PASSWORD': os.getenv('DB_PASSWORD'),
            'HOST': os.getenv('DB_HOST'),
            'PORT': os.getenv('DB_PORT'),
        }
    }

if CARTEIRA_DATABASE_URL or CARTEIRA_DB_NAME:
    if CARTEIRA_DATABASE_URL:
        carteira_config = dj_database_url.parse(
            CARTEIRA_DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    else:
        carteira_config = {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': CARTEIRA_DB_NAME,
            'USER': os.getenv('CARTEIRA_DB_USER'),
            'PASSWORD': os.getenv('CARTEIRA_DB_PASSWORD'),
            'HOST': os.getenv('CARTEIRA_DB_HOST'),
            'PORT': os.getenv('CARTEIRA_DB_PORT'),
        }
    DATABASES['carteira'] = carteira_config

for env_key, env_value in os.environ.items():
    if not env_key.startswith('CARTEIRA_DATABASE_URL_'):
        continue
    alias_suffix = env_key.replace('CARTEIRA_DATABASE_URL_', '').strip().lower()
    if not alias_suffix:
        continue
    alias = f"carteira_{alias_suffix}"
    if env_value:
        DATABASES.setdefault(alias, dj_database_url.config(
            default=env_value,
            conn_max_age=600,
            conn_health_checks=True,
        ))

# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

# 👇 MUDANÇA 1: Definindo o idioma padrão para Português do Brasil
LANGUAGE_CODE = 'pt-br'

TIME_ZONE = 'America/Sao_Paulo' # <--- MUDANÇA 2: Usando o fuso horário de São Paulo

USE_I18N = True

# 👇 MUDANÇA 3: Habilitando a localização de formatos de data, hora e número
USE_L10N = True 

USE_TZ = True

# Static files (CSS, JavaScript, Images )
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = 'static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
STATICFILES_DIRS = [BASE_DIR / 'static']

# WhiteNoise - configuração movida para o bloco STORAGES abaixo


# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Token da API do Escavador
ESCAVADOR_API_TOKEN = os.getenv("ESCAVADOR_API_TOKEN")
JUDICIAL_API_KEY = os.getenv("JUDICIAL_API_KEY")
NOWLEX_JUDICIAL_API_KEY = os.getenv("NOWLEX_JUDICIAL_API_KEY")
NOWLEX_CALC_API_BASE = os.getenv("NOWLEX_CALC_API_BASE", "https://calc.nowlex.com")
NOWLEX_CALC_API_KEY = os.getenv("NOWLEX_CALC_API_KEY")
NOWLEX_CALC_DATA_CORRENTE_MES = os.getenv("NOWLEX_CALC_DATA_CORRENTE_MES")
NOWLEX_CALC_DATA_CORRENTE_ANO = os.getenv("NOWLEX_CALC_DATA_CORRENTE_ANO")
NOWLEX_CALC_INDICE = os.getenv("NOWLEX_CALC_INDICE")
NOWLEX_CALC_OBSERVATIONS = os.getenv("NOWLEX_CALC_OBSERVATIONS")

# Gotenberg - Serviço de conversão de documentos (DOCX -> PDF)
GOTENBERG_URL = os.getenv("GOTENBERG_URL", "")

# Arquivos enviados (uploads)
# Configuração do AWS S3 para armazenamento de arquivos
AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
AWS_STORAGE_BUCKET_NAME = os.getenv('AWS_STORAGE_BUCKET_NAME')
AWS_S3_REGION_NAME = os.getenv('AWS_S3_REGION_NAME', 'us-east-1')
AWS_S3_SIGNATURE_VERSION = 's3v4'  # Versão de assinatura mais segura
AWS_S3_OBJECT_PARAMETERS = {
    'CacheControl': 'max-age=86400',
}
AWS_DEFAULT_ACL = None
AWS_S3_FILE_OVERWRITE = False
AWS_QUERYSTRING_AUTH = True  # Gera URLs assinadas automaticamente (protegido)
AWS_QUERYSTRING_EXPIRE = 5600  # URLs válidas por 5 hora (renovam automaticamente) - teste

# Usa S3 em produção se as credenciais estiverem configuradas, senão usa armazenamento local
if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY and AWS_STORAGE_BUCKET_NAME:
    STORAGES = {
        "default": {
            "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
        },
    }
    # MEDIA_URL não é usado com URLs assinadas - o storage gera URLs automaticamente
    MEDIA_URL = f'https://{AWS_STORAGE_BUCKET_NAME}.s3.{AWS_S3_REGION_NAME}.amazonaws.com/'
else:
    # Armazenamento local (desenvolvimento)
    STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
        },
    }
    MEDIA_URL = '/media/'
    MEDIA_ROOT = BASE_DIR / 'media'

# Configurações de segurança para produção
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# CSRF Trusted Origins (adicione seu domínio Render aqui)
CSRF_TRUSTED_ORIGINS = os.getenv('CSRF_TRUSTED_ORIGINS', '').split(',') if os.getenv('CSRF_TRUSTED_ORIGINS') else []

# Logging configuration
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'contratos': {
            'handlers': ['console'],
            'level': os.getenv('LOG_LEVEL', 'INFO'),
            'propagate': False,
        },
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}

# Add Sentry handler if enabled
if sentry_enabled:
    LOGGING['handlers']['sentry'] = {
        'level': 'ERROR',
        'class': 'sentry_sdk.integrations.logging.SentryHandler',
    }
    LOGGING['loggers']['contratos']['handlers'].append('sentry')

# URLs de autenticação - redireciona para o admin
LOGIN_URL = '/admin/login/'
LOGIN_REDIRECT_URL = '/admin/'
LOGOUT_REDIRECT_URL = '/admin/login/'
