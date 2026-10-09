"""Project lint rules that enforce docs/02 §6.1.2 on every model."""

import re
import typing as t

from sqlglot import exp
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


# What an ingestion tool leaves behind besides the landing contract: its own columns and tables
# (`_dlt_load_id`, `_dlt_loads`…) and the schema it writes into before the adapter publishes the
# landing views. Neither is a contract; reading them ties a model to one ingestion tool.
# One of the two places outside packages/ingestion that name its tool, on purpose (decision D2,
# docs/21 §2.4): this rule runs inside SQLMesh, in Python, and cannot read the prefix from the
# ingestion package. A test in packages/ingestion lists it as a known exception.
TOOL_METADATA = re.compile(r"^_dlt", re.IGNORECASE)
INGESTION_INTERNAL_SCHEMA = re.compile(r"^ingestion_", re.IGNORECASE)


class NoIngestionInternals(Rule):
    """Models read landing contracts only — never an ingestion tool's metadata or its internal schema."""

    def check_model(self, model: Model) -> t.Optional[RuleViolation]:
        candidates = [
            getattr(model, "query", None),
            *getattr(model, "pre_statements", []),
            *getattr(model, "post_statements", []),
            *getattr(model, "on_virtual_update", []),
        ]
        for candidate in candidates:
            if candidate is None:
                continue
            if not isinstance(candidate, exp.Expression):
                # A statement SQLMesh kept as text: no syntax tree to walk, so read the text.
                text = str(candidate)
                if re.search(r"\b_dlt\w*|\bingestion_\w*\.", text, re.IGNORECASE):
                    return self.violation(
                        "a statement reads ingestion internals: models read the landing "
                        "contracts only (docs/21-engineering-standards.md §2.4)."
                    )
                continue
            for table in candidate.find_all(exp.Table):
                if INGESTION_INTERNAL_SCHEMA.match(table.db or ""):
                    return self.violation(
                        f"{table.db} is ingestion's internal schema: models read the landing "
                        "contracts only (docs/21-engineering-standards.md §2.4)."
                    )
            for identifier in candidate.find_all(exp.Identifier):
                if TOOL_METADATA.match(identifier.name):
                    return self.violation(
                        f"{identifier.name} is the ingestion tool's metadata, never a model's input: "
                        "use the landing contract's _load_id and _loaded_at "
                        "(docs/21-engineering-standards.md §2.4)."
                    )
        return None
