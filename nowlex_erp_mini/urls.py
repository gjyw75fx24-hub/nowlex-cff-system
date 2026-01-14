# nowlex_erp_mini/urls.py
from django.contrib import admin
from django.urls import path, include
from contratos import views as contratos_views
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic.base import RedirectView
from django.templatetags.static import static as static_file

urlpatterns = [
    path('admin/', admin.site.urls),

    # Redireciona a página inicial para o admin
    path('', RedirectView.as_view(url='/admin/', permanent=False)),

    # URLs do app de contratos (incluindo a API)
    path('favicon.ico', RedirectView.as_view(url=static_file('favicon/favicon-32x32.png'), permanent=False)),
    path('contratos/', include('contratos.urls')),

    # API na raiz para compatibilidade com frontend
    path('api/', include('contratos.api.urls', namespace='api_root')),
    path('api/decision-tree/', contratos_views.get_decision_tree_data, name='decision_tree_root'),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
