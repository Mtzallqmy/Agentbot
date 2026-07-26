"""Initial owner, providers, conversations, jobs, agent and audit schema.

Revision ID: 0001
Revises:
"""
from alembic import op

from platform_api.models import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    metadata = Base.metadata
    bind = op.get_bind()
    for table in reversed(metadata.sorted_tables):
        table.drop(bind=bind, checkfirst=True)
