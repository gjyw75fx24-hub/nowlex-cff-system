# nowlex_erp_mini/urls.py
from django.contrib import admin
from django.urls import path, include
from contratos import views as contratos_views
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # URLs do app de contratos (incluindo a API)
    path('', include('contratos.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
