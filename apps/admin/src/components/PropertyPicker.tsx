import type { Property } from "@homefax/db";
import { cityOf, streetOf } from "@/lib/format";

/** A select over the houses the institution can reach. Nothing it cannot see is offered. */
export default function PropertyPicker({ id = "propertyId", name = "propertyId", properties, selected, label = "Property" }: { id?: string; name?: string; properties: Property[]; selected?: string; label?: string }) {
  return (
    <div>
      <label className="label block" htmlFor={id}>
        {label}
      </label>
      <select id={id} name={name} required defaultValue={selected ?? ""} className="input input-sm select mt-1.5">
        <option value="" disabled>
          {properties.length ? "Pick a house you can see" : "No houses in view — request access first"}
        </option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {streetOf(p)} · {cityOf(p)}
          </option>
        ))}
      </select>
    </div>
  );
}
