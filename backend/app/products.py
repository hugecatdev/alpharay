from app.schemas import Product


def okved_eligible(product: Product, okved: str) -> bool:
    if not product.okved_prefixes:
        return True
    code = okved.strip()
    return any(code.startswith(prefix) for prefix in product.okved_prefixes)
