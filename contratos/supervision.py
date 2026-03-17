from django.contrib.auth.models import Group

SUPERVISOR_GROUP_NAME = "Supervisor"
SUPERVISOR_DEVELOPER_GROUP_NAME = "Supervisor Desenvolvedor"


def ensure_supervisor_group():
    group, _ = Group.objects.get_or_create(name=SUPERVISOR_GROUP_NAME)
    return group


def ensure_supervisor_developer_group():
    group, _ = Group.objects.get_or_create(name=SUPERVISOR_DEVELOPER_GROUP_NAME)
    return group


def is_user_supervisor_developer(user):
    if not user or not getattr(user, 'pk', None):
        return False
    return user.groups.filter(name=SUPERVISOR_DEVELOPER_GROUP_NAME).exists()


def is_user_supervisor(user):
    if not user or not getattr(user, 'pk', None):
        return False
    return user.groups.filter(name__in=[SUPERVISOR_GROUP_NAME, SUPERVISOR_DEVELOPER_GROUP_NAME]).exists()
