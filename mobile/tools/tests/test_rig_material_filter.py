import unittest
from dataclasses import dataclass

from mobile.tools.rig_material_filter import retained_vertices_for_materials


@dataclass
class Polygon:
    material_index: int
    vertices: tuple[int, ...]


class RigMaterialFilterTests(unittest.TestCase):
    def test_excludes_target_material_and_shared_vertices_stay_retained(self):
        polygons = [Polygon(0, (0, 1, 2, 3)), Polygon(1, (2, 3, 4))]
        result = retained_vertices_for_materials(
            polygons,
            ("Body", "NUG_Skin_Leg"),
            ("Body", "NUG_Skin_Leg"),
            6,
            frozenset({"NUG_Skin_Leg"}),
        )
        self.assertEqual(result.retained_vertex_ids, (0, 1, 2, 3))
        self.assertEqual(result.retained_face_count, 1)
        self.assertEqual(result.excluded_face_count, 1)
        self.assertEqual(result.excluded_only_vertex_count, 1)

    def test_reordered_evaluated_slots_use_evaluated_material_index(self):
        result = retained_vertices_for_materials(
            [Polygon(0, (0, 1, 2)), Polygon(1, (3, 4, 5))],
            ("NUG_Skin_Leg", "Body"),
            ("NUG_Skin_Leg", "Body"),
            6,
            frozenset({"NUG_Skin_Leg"}),
        )
        self.assertEqual(result.retained_vertex_ids, (3, 4, 5))

    def test_invalid_material_index_fails_closed(self):
        for index in (-1, 2, True):
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, "invalid evaluated material index"):
                retained_vertices_for_materials(
                    [Polygon(index, (0, 1, 2))], ("Body",), ("Body",), 3, frozenset()
                )

    def test_material_table_mismatch_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "material table mismatch"):
            retained_vertices_for_materials(
                [Polygon(0, (0, 1, 2))], ("Body",), ("NUG_Skin_Leg",), 3, frozenset()
            )

    def test_missing_used_slot_name_fails_closed(self):
        for names in ((None,), ("",)):
            with self.subTest(names=names), self.assertRaisesRegex(ValueError, "missing evaluated material name"):
                retained_vertices_for_materials([Polygon(0, (0, 1, 2))], names, names, 3, frozenset())

    def test_invalid_vertex_ids_fail_closed(self):
        for ids in ((0, 1, 3), (-1, 1, 2), (0, True, 2), (0, 1)):
            with self.subTest(ids=ids), self.assertRaisesRegex(ValueError, "invalid vertex IDs"):
                retained_vertices_for_materials(
                    [Polygon(0, ids)], ("Body",), ("Body",), 3, frozenset()
                )

    def test_unreferenced_and_excluded_only_vertices_are_never_selected(self):
        result = retained_vertices_for_materials(
            [Polygon(1, (3, 4, 5))],
            ("Body", "NUG_Skin_Leg"),
            ("Body", "NUG_Skin_Leg"),
            8,
            frozenset({"NUG_Skin_Leg"}),
        )
        self.assertEqual(result.retained_vertex_ids, ())
        self.assertEqual(result.excluded_only_vertex_count, 3)

    def test_no_coordinate_or_tessellation_api_is_called(self):
        class TrappedPolygon:
            material_index = 0

            @property
            def vertices(self):
                return (0, 1, 2)

        result = retained_vertices_for_materials(
            [TrappedPolygon()], ("Body",), ("Body",), 3, frozenset()
        )
        self.assertEqual(result.retained_vertex_ids, (0, 1, 2))
        self.assertFalse(hasattr(result, "coordinates"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
