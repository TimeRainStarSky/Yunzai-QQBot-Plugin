import pd from "@goodtools/protobuf-decoder"
function simplify(data) {
  const object = {}
  for (const i of data.fields)
    object[i.field] = i.object ? simplify(i.value) : i.value
  return object
}
export const decode = (...args) => simplify(pd.decode(...args))