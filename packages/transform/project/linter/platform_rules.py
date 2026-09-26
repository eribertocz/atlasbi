"""Project lint rules that enforce docs/02 §6.1.2 on every model."""

import re
import typing as t

from sqlmesh.core.linter.rule import Rule, RuleViolation
from sqlmesh.core.model import Model

# Statements that change what the engine can reach or how it is configured. Sources are attached
# by the platform, from its registry and with its credentials — never by a model.
FORBIDDEN = re.compile(
    r"^\s*(ATTACH|DETACH|INSTALL|LOAD|SET|RESET|PRAGMA|USE|COPY|EXPORT|IMPORT"
    r"|CREATE\s+(OR\s+REPLACE\s+)?(PERSISTENT\s+|TEMPORARY\s+)?SECRET|DROP\s+(PERSISTENT\s+|TEMPORARY\s+)?SECRET)\b",
    re.IGNORECASE,
)


class NoPlatformManagedStatements(Rule):
    """Models must not attach sources, install or load extensions, change settings, manage secrets or write files."""

    def check_model(self, model: Model) -> t.Optional[RuleViolation]:
        statements = [
            *getattr(model, "pre_statements", []),
            *getattr(model, "post_statements", []),
            *getattr(model, "on_virtual_update", []),
        ]
        for statement in statements:
            sql = statement.sql(dialect="duckdb") if hasattr(statement, "sql") else str(statement)
            match = FORBIDDEN.match(sql)
            if match:
                return self.violation(
                    f"{match.group(1).upper()} is managed by the platform, never by a model "
                    "(docs/02-transformacion.md §6.1.2)."
                )
        return None
